import React, { useState, useRef, useEffect } from 'react';
import MonacoEditor from '@monaco-editor/react';
import * as Y from 'yjs';
import { bindSharedDoc } from '@/lib/CrdtSync';
import { setPetCodeContext } from '@/lib/petContext';
import { type ExamQuestion, type ExamAnswer, runExamCode, secondsLeft, formatCountdown } from '@/lib/examClient';

interface ExamControllerOverlayProps {
    questions: ExamQuestion[];
    onDraftUpdate: (questionId: string, answer: ExamAnswer) => void;
    onSubmit: (questionId: string, answer: ExamAnswer) => void;
    // Server grading result per submitted question (true = correct)
    results?: Record<string, boolean>;
}

const recordingToDataUrl = (chunks: Blob[], mimeType: string) => new Promise<string>((resolve) => {
    const reader = new FileReader();
    reader.onloadend = () => resolve(reader.result as string);
    reader.readAsDataURL(new Blob(chunks, { type: mimeType || 'audio/webm' }));
});

export function ExamControllerOverlay({ questions, onDraftUpdate, onSubmit, results = {} }: ExamControllerOverlayProps) {
    const [answers, setAnswers] = useState<Record<string, ExamAnswer>>({});
    const answersRef = useRef<Record<string, ExamAnswer>>({});
    const [isRecording, setIsRecording] = useState<Record<string, boolean>>({});
    const [currentIndex, setCurrentIndex] = useState(0);
    const [submitted, setSubmitted] = useState<Record<string, boolean>>({});
    const [running, setRunning] = useState<Record<string, boolean>>({});
    const [now, setNow] = useState(() => Date.now());
    const feedback: Record<string, { status: 'correct' | 'wrong' }> = Object.fromEntries(
        Object.entries(results).map(([id, correct]) => [id, { status: correct ? 'correct' : 'wrong' }])
    );
    const mediaRecorderRefs = useRef<Record<string, MediaRecorder>>({});
    const audioChunksRefs = useRef<Record<string, Blob[]>>({});
    const yDocRef = useRef<Y.Doc>(new Y.Doc());
    const bindingRef = useRef<{ destroy: () => void } | null>(null);

    // One place that changes an answer, so recordings and code runs that finish later never
    // overwrite what was typed meanwhile (they used to merge into a stale copy)
    const updateAnswer = (qId: string, patch: Partial<ExamAnswer>, removeAudio = false) => {
        const next: ExamAnswer = { ...answersRef.current[qId], ...patch };
        if (removeAudio) delete next.audio;
        answersRef.current = { ...answersRef.current, [qId]: next };
        setAnswers(answersRef.current);
        return next;
    };

    // After a reload or reconnect the server sends the saved draft back with the question
    useEffect(() => {
        const restored: Record<string, ExamAnswer> = {};
        questions.forEach((q) => {
            if (q.draft && !answersRef.current[q.id]) restored[q.id] = { ...q.draft, audio: q.draft.audio || undefined };
        });
        if (Object.keys(restored).length === 0) return;
        answersRef.current = { ...answersRef.current, ...restored };
        setAnswers(answersRef.current);
    }, [questions]);

    const anyTimed = questions.some(q => !q.closed && typeof q.endsAt === 'number');
    useEffect(() => {
        if (!anyTimed) return;
        const timer = setInterval(() => setNow(Date.now()), 1000);
        return () => clearInterval(timer);
    }, [anyTimed]);

    useEffect(() => {
        // Streams keystrokes to the invigilator only; the host never relays one candidate's code to another
        const doc = yDocRef.current;
        const unbind = bindSharedDoc('exam-code', doc);
        const recorders = mediaRecorderRefs.current;

        return () => {
            unbind();
            bindingRef.current?.destroy();
            bindingRef.current = null;
            // Leaving the exam view must not leave the microphone on
            Object.values(recorders).forEach((recorder) => {
                if (recorder.state !== 'inactive') recorder.stop();
                recorder.stream.getTracks().forEach(t => t.stop());
            });
        };
    }, []);

    const isClosed = (q: ExamQuestion) => Boolean(q.closed) || secondsLeft(q, now) === 0;

    // One shared Y.Text per question; seeded from the editor so the starter code/draft is not wiped on bind
    const handleEditorMount = async (editor: any, questionId: string) => {
        const { MonacoBinding } = await import('y-monaco');
        const model = editor.getModel();
        if (!model) return;
        const yText = yDocRef.current.getText(`monaco:${questionId}`);
        if (yText.length === 0 && model.getValue()) yText.insert(0, model.getValue());
        bindingRef.current?.destroy();
        bindingRef.current = new MonacoBinding(yText, model, new Set([editor]), null);
        setPetCodeContext(model.getValue(), questions.find(item => item.id === questionId)?.language);
    };

    const handleAnswerChange = (qId: string, val: string) => {
        const newAns = updateAnswer(qId, { text: val });
        // Typing sends the text only; the server keeps an existing recording
        const { audio: _keptOnServer, ...textDraft } = newAns;
        onDraftUpdate(qId, textDraft);
    };

    const stopRecording = (qId: string) => new Promise<void>((resolve) => {
        const recorder = mediaRecorderRefs.current[qId];
        if (!recorder || recorder.state === 'inactive') {
            resolve();
            return;
        }
        recorder.onstop = async () => {
            const audio = await recordingToDataUrl(audioChunksRefs.current[qId] || [], recorder.mimeType);
            onDraftUpdate(qId, updateAnswer(qId, { audio }));
            resolve();
        };
        recorder.stop();
        recorder.stream.getTracks().forEach(t => t.stop());
        delete mediaRecorderRefs.current[qId];
        setIsRecording(prev => ({ ...prev, [qId]: false }));
    });

    const toggleRecording = async (qId: string) => {
        if (isRecording[qId]) {
            await stopRecording(qId);
            return;
        }

        try {
            const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
            const mediaRecorder = new MediaRecorder(stream);
            mediaRecorderRefs.current[qId] = mediaRecorder;
            audioChunksRefs.current[qId] = [];

            mediaRecorder.ondataavailable = (event) => {
                if (event.data.size > 0) audioChunksRefs.current[qId].push(event.data);
            };

            mediaRecorder.start();
            setIsRecording(prev => ({ ...prev, [qId]: true }));
        } catch {
            alert('Microphone access denied or not available.');
        }
    };

    const handleOptionSelect = (qId: string, option: string) => {
        onDraftUpdate(qId, updateAnswer(qId, { text: option }));
    };

    // The output is shown to the invigilator with the code, but grading never relies on it
    const runCode = async (qId: string, code: string, language: string) => {
        setRunning(prev => ({ ...prev, [qId]: true }));
        updateAnswer(qId, { output: 'Running...' });
        try {
            const { output } = await runExamCode(language, code);
            const { audio: _keptOnServer, ...draft } = updateAnswer(qId, { text: code, output });
            onDraftUpdate(qId, draft);
        } finally {
            setRunning(prev => ({ ...prev, [qId]: false }));
        }
    };

    const handleSubmit = async (qId: string) => {
        if (submitted[qId]) return;
        const q = questions.find(question => question.id === qId);
        if (!q || isClosed(q)) return;
        setSubmitted(prev => ({ ...prev, [qId]: true }));
        if (isRecording[qId]) await stopRecording(qId);

        const current = answersRef.current[qId];
        const finalAnswer: ExamAnswer = current
            ? { text: current.text, options: current.options, audio: current.audio, output: current.output === 'Running...' ? undefined : current.output }
            : { text: q.type === 'code' ? q.starterCode || '' : '' };
        // Grading happens on the server (candidates never receive the answer key)
        onSubmit(qId, finalAnswer);
    };

    if (!questions || questions.length === 0) return null;

    const validIndex = Math.min(currentIndex, questions.length - 1);
    const q = questions[validIndex];
    const closed = isClosed(q);
    const left = secondsLeft(q, now);
    const locked = closed || Boolean(submitted[q.id]);
    const unsubmitted = questions.filter(question => !submitted[question.id] && !isClosed(question));

    return (
        <div className="w-full h-full flex flex-col p-6 font-sans text-[var(--text-primary)] relative">
            <button
                onClick={() => {
                    if (unsubmitted.length === 0) return;
                    if (window.confirm(`Submit ${unsubmitted.length === 1 ? 'your remaining answer' : `all ${unsubmitted.length} remaining answers`}? You cannot change them afterwards.`)) unsubmitted.forEach(question => handleSubmit(question.id));
                }}
                disabled={unsubmitted.length === 0}
                className="absolute top-6 right-6 w-8 h-8 flex items-center justify-center rounded-full bg-[var(--elevated)] border border-[var(--border)]/60 text-[var(--text-primary)] hover:bg-red-500/20 hover:text-red-400 hover:border-red-500/50 transition-all font-bold disabled:opacity-40"
                title="Submit all remaining answers"
                aria-label="Submit all remaining answers"
            >
                ×
            </button>
            <h2 className="text-2xl font-black mb-6 bg-gradient-to-r from-blue-400 to-purple-500 bg-clip-text text-transparent tracking-tight pb-2 border-b border-[var(--border)]/60 pr-10">Active Questions</h2>

            <div className="flex items-center justify-between mb-4 bg-[var(--elevated)] border border-[var(--border)]/60 rounded-xl p-3 shadow-inner">
                <button
                    onClick={() => setCurrentIndex(Math.max(0, validIndex - 1))}
                    disabled={validIndex === 0}
                    className="px-3 py-1 bg-[var(--bg)] text-[var(--text-primary)] rounded-lg disabled:opacity-50 border border-[var(--border)]/60 hover:bg-[var(--elevated)] transition-colors text-sm font-bold"
                >
                    ← Prev
                </button>
                <span className="text-sm font-medium text-[var(--text-primary)] flex items-center gap-2">
                    Question {validIndex + 1} of {questions.length}
                    {left !== null && (
                        <span
                            className={`text-xs font-mono font-bold px-2 py-0.5 rounded-full border ${closed ? 'bg-[var(--bg)] text-[var(--text-secondary)] border-[var(--border)]' : left <= 30 ? 'bg-red-500/20 text-red-400 border-red-500/30 animate-pulse' : 'bg-blue-500/10 text-blue-300 border-blue-500/30'}`}
                            role="timer"
                            aria-label="Time left for this question"
                        >
                            {closed ? 'Time is up' : `${formatCountdown(left)} left`}
                        </span>
                    )}
                </span>
                <button
                    onClick={() => setCurrentIndex(Math.min(questions.length - 1, validIndex + 1))}
                    disabled={validIndex === questions.length - 1}
                    className="px-3 py-1 bg-[var(--bg)] text-[var(--text-primary)] rounded-lg disabled:opacity-50 border border-[var(--border)]/60 hover:bg-[var(--elevated)] transition-colors text-sm font-bold"
                >
                    Next →
                </button>
            </div>

            <div className="flex-1 overflow-y-auto overflow-x-hidden flex flex-col gap-6 pr-2 custom-scrollbar">
                <div key={q.id} className="bg-[var(--elevated)] border border-[var(--border)]/60 p-5 rounded-2xl flex flex-col gap-4 relative overflow-hidden backdrop-blur-md shadow-inner">
                    <div className="absolute top-0 left-0 w-1 h-full bg-blue-500/50" />

                    <div className="flex flex-col gap-3">
                        <p className="font-medium text-[15px] leading-relaxed text-[var(--text-primary)]">
                            <span className="font-bold text-blue-400 mr-2">Q:</span>
                            {q.prompt}
                        </p>

                        {q.voicePrompt && (
                            <audio src={q.voicePrompt} controls className="h-8 w-full rounded-lg" />
                        )}
                    </div>

                    {q.type === 'freeform' && (
                        <div className="flex flex-col gap-3">
                            <div className="relative mt-2">
                                <textarea
                                    className="w-full bg-[var(--bg)]/70 border border-[var(--border)]/60 rounded-xl p-4 text-sm text-[var(--text-primary)] placeholder-[var(--text-secondary)] focus:outline-none focus:ring-2 focus:ring-blue-500/50 min-h-[120px] transition-all resize-none shadow-inner disabled:opacity-60"
                                    placeholder="Type your answer..."
                                    value={answers[q.id]?.text || ''}
                                    disabled={locked}
                                    onChange={(e) => handleAnswerChange(q.id, e.target.value)}
                                />

                                {answers[q.id]?.audio && (
                                    <div className="mt-3 flex items-center gap-2 bg-[var(--bg)]/70 p-2 rounded-xl border border-[var(--border)]/60">
                                        <audio src={answers[q.id].audio || undefined} controls className="h-8 w-full" />
                                        {!locked && (
                                            <button
                                                onClick={() => {
                                                    const newAns = updateAnswer(q.id, {}, true);
                                                    onDraftUpdate(q.id, { ...newAns, audio: null }); // null removes it on the server
                                                }}
                                                className="text-red-400 hover:text-red-300 font-bold px-2"
                                                aria-label="Remove recording"
                                            >
                                                ×
                                            </button>
                                        )}
                                    </div>
                                )}

                                {!locked && (
                                    <button
                                        onClick={() => toggleRecording(q.id)}
                                        className={`absolute bottom-3 right-3 px-3 py-1.5 rounded-lg font-bold text-xs flex items-center gap-2 transition-all ${isRecording[q.id] ? 'bg-red-500/20 text-red-400 border border-red-500/50 shadow-[0_0_10px_rgba(239,68,68,0.2)] animate-pulse' : 'bg-[var(--elevated)] text-[var(--text-primary)] border border-[var(--border)]/60 hover:bg-[var(--elevated)]/80 hover:text-[var(--text-primary)]'}`}
                                    >
                                        {isRecording[q.id] ? (
                                            <><span className="w-2 h-2 rounded-full bg-red-400" /> Recording...</>
                                        ) : (
                                            <>🎤 Record Voice</>
                                        )}
                                    </button>
                                )}
                            </div>
                        </div>
                    )}

                    {(q.type === 'mc' || q.type === 'poll') && (
                        <div className="flex flex-col gap-3">
                            {q.options?.map(opt => (
                                <label key={opt} className={`flex items-center gap-4 p-4 border rounded-xl transition-all ${locked ? 'cursor-default opacity-70' : 'cursor-pointer'} ${answers[q.id]?.text === opt ? 'bg-blue-500/10 border-blue-400 shadow-[0_0_15px_rgba(59,130,246,0.15)]' : 'bg-[var(--bg)]/70 border-[var(--border)]/60 hover:bg-[var(--elevated)]'}`}>
                                    <div className={`w-5 h-5 rounded-full border-2 flex items-center justify-center transition-colors ${answers[q.id]?.text === opt ? 'border-blue-400' : 'border-[var(--border-bright)]/80'}`}>
                                        {answers[q.id]?.text === opt && <div className="w-2.5 h-2.5 rounded-full bg-blue-400" />}
                                    </div>
                                    <input
                                        type="radio"
                                        name={`q-${q.id}`}
                                        checked={answers[q.id]?.text === opt}
                                        disabled={locked}
                                        onChange={() => handleOptionSelect(q.id, opt)}
                                        className="hidden"
                                    />
                                    <span className={answers[q.id]?.text === opt ? 'text-[var(--text-primary)] font-medium' : 'text-[var(--text-primary)]'}>{opt}</span>
                                </label>
                            ))}
                        </div>
                    )}

                    {q.type === 'code' && (
                        <div className="flex flex-col gap-3">
                            <div className="h-72 border border-[var(--border)]/60 rounded-xl overflow-hidden shadow-inner bg-[var(--bg)]/60">
                                <MonacoEditor
                                    key={q.id}
                                    path={q.id}
                                    height="100%"
                                    language={q.language || 'javascript'}
                                    theme="vs-dark"
                                    defaultValue={answers[q.id]?.text ?? q.draft?.text ?? q.starterCode ?? ''}
                                    onChange={(val) => {
                                        if (locked) return
                                        handleAnswerChange(q.id, val || '')
                                        setPetCodeContext(val || '', q.language)
                                    }}
                                    onMount={(editor) => handleEditorMount(editor, q.id)}
                                    options={{ minimap: { enabled: false }, fontSize: 14, padding: { top: 16 }, readOnly: locked }}
                                />
                            </div>
                            <div className="flex justify-between items-center mt-2 px-1">
                                <span className="text-[10px] text-[var(--text-primary)] tracking-widest uppercase bg-[var(--elevated)] px-3 py-1 rounded-full border border-[var(--border)]/60">{q.language}</span>
                                <button
                                    onClick={() => runCode(q.id, answers[q.id]?.text ?? q.starterCode ?? '', q.language || 'javascript')}
                                    disabled={locked || running[q.id]}
                                    className="bg-green-500/10 text-green-400 border border-green-500/30 px-5 py-2 rounded-xl font-bold text-sm hover:bg-green-500/20 transition-colors flex items-center gap-2 disabled:opacity-50"
                                >
                                    {running[q.id] ? 'Running...' : '▶ Run Code'}
                                </button>
                            </div>
                            {answers[q.id]?.output && (
                                <div className="mt-3 p-4 bg-[var(--bg)]/80 border border-[var(--border)] rounded-xl font-mono text-[13px] text-green-400/90 whitespace-pre-wrap max-h-48 overflow-y-auto shadow-inner custom-scrollbar">
                                    {answers[q.id]?.output}
                                </div>
                            )}
                        </div>
                    )}

                    <div className="mt-6 flex items-center justify-between gap-3">
                        {feedback[q.id] ? (
                            <div className={`px-4 py-2 rounded-xl font-bold text-sm flex items-center gap-2 ${feedback[q.id].status === 'correct' ? 'bg-green-500/20 text-green-400 border border-green-500/30' : 'bg-red-500/20 text-red-400 border border-red-500/30'}`}>
                                {feedback[q.id].status === 'correct' ? '✓ Correct!' : '✗ Incorrect'}
                            </div>
                        ) : closed && !submitted[q.id] ? (
                            <div className="text-xs text-[var(--text-secondary)]">Time is up: your last saved answer is submitted.</div>
                        ) : (
                            <div />
                        )}
                        <button
                            onClick={() => handleSubmit(q.id)}
                            disabled={locked}
                            className="bg-gradient-to-r from-blue-600 to-indigo-600 text-[var(--text-primary)] font-bold px-8 py-2.5 rounded-xl shadow-lg hover:shadow-blue-500/25 hover:from-blue-500 hover:to-indigo-500 transition-all active:scale-[0.98] disabled:opacity-50 disabled:cursor-not-allowed"
                        >
                            {submitted[q.id] ? 'Submitted' : 'Submit Answer'}
                        </button>
                    </div>
                </div>
            </div>
            <style dangerouslySetInnerHTML={{__html: `
                .custom-scrollbar::-webkit-scrollbar { width: 4px; }
                .custom-scrollbar::-webkit-scrollbar-track { background: transparent; }
                .custom-scrollbar::-webkit-scrollbar-thumb { background: rgba(255,255,255,0.1); border-radius: 4px; }
            `}} />
        </div>
    );
}
