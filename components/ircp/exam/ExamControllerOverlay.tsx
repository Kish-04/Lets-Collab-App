import React, { useState, useRef, useEffect } from 'react';
import MonacoEditor from '@monaco-editor/react';
import { ExamQuestion } from './ExamHostDashboard';
import * as Y from 'yjs';
import { dataChannelManager } from '@/lib/DataChannelManager';

interface ExamControllerOverlayProps {
    questions: ExamQuestion[];
    onDraftUpdate: (questionId: string, answer: any) => void;
    onSubmit: (questionId: string, answer: any) => void;
}

export function ExamControllerOverlay({ questions, onDraftUpdate, onSubmit }: ExamControllerOverlayProps) {
    const [answers, setAnswers] = useState<Record<string, any>>({});
    const [isRecording, setIsRecording] = useState<Record<string, boolean>>({});
    const [currentIndex, setCurrentIndex] = useState(0);
    const [feedback, setFeedback] = useState<Record<string, { status: 'correct' | 'wrong' }>>({});
    const mediaRecorderRefs = useRef<Record<string, MediaRecorder>>({});
    const audioChunksRefs = useRef<Record<string, Blob[]>>({});
    const yDocRef = useRef<Y.Doc>(new Y.Doc());
    const yTextRef = useRef<Y.Text>(yDocRef.current.getText('monaco'));
    
    useEffect(() => {
        const doc = yDocRef.current;
        const updateHandler = (update: Uint8Array, origin: any) => {
            if (origin !== 'remote') {
                const arr = Array.from(update);
                dataChannelManager.send('yjs-update', { update: arr });
            }
        };
        doc.on('update', updateHandler);

        const remoteHandler = (payload: any) => {
            if (payload && payload.update) {
                const arr = new Uint8Array(payload.update);
                Y.applyUpdate(doc, arr, 'remote');
            }
        };
        dataChannelManager.on('yjs-update', remoteHandler);

        return () => {
            doc.off('update', updateHandler);
            dataChannelManager.off('yjs-update', remoteHandler);
        };
    }, []);

    const handleEditorMount = async (editor: any) => {
        const { MonacoBinding } = await import('y-monaco');
        new MonacoBinding(yTextRef.current, editor.getModel(), new Set([editor]), null);
    };

    const handleAnswerChange = (qId: string, val: string) => {
        const newAns = { ...answers[qId], text: val };
        setAnswers(prev => ({ ...prev, [qId]: newAns }));
        onDraftUpdate(qId, newAns);
    };

    const toggleRecording = async (qId: string) => {
        if (isRecording[qId]) {
            mediaRecorderRefs.current[qId]?.stop();
            mediaRecorderRefs.current[qId]?.stream.getTracks().forEach(t => t.stop());
            setIsRecording(prev => ({ ...prev, [qId]: false }));
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

            mediaRecorder.onstop = () => {
                const audioBlob = new Blob(audioChunksRefs.current[qId], { type: 'audio/webm' });
                const reader = new FileReader();
                reader.readAsDataURL(audioBlob);
                reader.onloadend = () => {
                    const base64Audio = reader.result;
                    const newAns = { ...answers[qId], audio: base64Audio };
                    setAnswers(prev => ({ ...prev, [qId]: newAns }));
                    onDraftUpdate(qId, newAns);
                };
            };

            mediaRecorder.start();
            setIsRecording(prev => ({ ...prev, [qId]: true }));
        } catch (err) {
            alert('Microphone access denied or not available.');
        }
    };

    const handleOptionSelect = (qId: string, option: string) => {
        const newAns = { text: option };
        setAnswers(prev => ({ ...prev, [qId]: newAns }));
        onDraftUpdate(qId, newAns);
    };

    const runCode = async (qId: string, code: string, language: string) => {
        setAnswers(prev => ({ ...prev, [qId]: { ...prev[qId], output: 'Running...' } }));
        try {
            const res = await fetch('/api/execute', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    language: language,
                    version: '*', 
                    files: [{ content: code }]
                })
            });
            const data = await res.json();
            const output = data.run ? (data.run.output || data.run.stderr || 'No output') : 'Execution failed';
            
            const newAns = { ...answers[qId], text: code, output };
            setAnswers(prev => ({ ...prev, [qId]: newAns }));
            onDraftUpdate(qId, newAns);
        } catch (err) {
            const newAns = { ...answers[qId], text: code, output: 'Sandbox Error / Network Error' };
            setAnswers(prev => ({ ...prev, [qId]: newAns }));
            onDraftUpdate(qId, newAns);
        }
    };

    const handleSubmit = async (qId: string) => {
        const q = questions.find(question => question.id === qId);
        let finalAnswer = answers[qId] || { text: q?.type === 'code' ? q.starterCode || '' : '' };
        
        if (isRecording[qId]) {
            await new Promise<void>((resolve) => {
                const recorder = mediaRecorderRefs.current[qId];
                if (recorder) {
                    recorder.onstop = () => {
                        const audioBlob = new Blob(audioChunksRefs.current[qId], { type: 'audio/webm' });
                        const reader = new FileReader();
                        reader.readAsDataURL(audioBlob);
                        reader.onloadend = () => {
                            const base64Audio = reader.result;
                            finalAnswer = { ...finalAnswer, audio: base64Audio };
                            setAnswers(prev => ({ ...prev, [qId]: finalAnswer }));
                            onDraftUpdate(qId, finalAnswer);
                            resolve();
                        };
                    };
                    recorder.stop();
                    recorder.stream.getTracks().forEach(t => t.stop());
                    setIsRecording(prev => ({ ...prev, [qId]: false }));
                } else {
                    resolve();
                }
            });
        }
        
        if (q?.answerKey) {
            let isCorrect = false;
            const keyLower = q.answerKey.toLowerCase().trim();
            if (q.type === 'mc' || q.type === 'poll') {
                isCorrect = (finalAnswer.text || '').toLowerCase().trim() === keyLower;
            } else if (q.type === 'code') {
                isCorrect = (finalAnswer.output || '').toLowerCase().trim().includes(keyLower);
            } else {
                isCorrect = (finalAnswer.text || '').toLowerCase().trim().includes(keyLower);
            }
            setFeedback(prev => ({ ...prev, [qId]: { status: isCorrect ? 'correct' : 'wrong' } }));
        }

        onSubmit(qId, finalAnswer);
    };

    if (!questions || questions.length === 0) return null;

    const validIndex = Math.min(currentIndex, questions.length - 1);
    const q = questions[validIndex];

    return (
        <div className="w-full h-full flex flex-col p-6 font-sans text-[var(--text-primary)]">
            <h2 className="text-2xl font-black mb-6 bg-gradient-to-r from-blue-400 to-purple-500 bg-clip-text text-transparent tracking-tight pb-2 border-b border-[var(--border)]/60">Active Questions</h2>
            
            <div className="flex items-center justify-between mb-4 bg-[var(--elevated)] border border-[var(--border)]/60 rounded-xl p-3 shadow-inner">
                <button 
                    onClick={() => setCurrentIndex(Math.max(0, validIndex - 1))}
                    disabled={validIndex === 0}
                    className="px-3 py-1 bg-[var(--bg)] text-[var(--text-primary)] rounded-lg disabled:opacity-50 border border-[var(--border)]/60 hover:bg-[var(--elevated)] transition-colors text-sm font-bold"
                >
                    ← Prev
                </button>
                <span className="text-sm font-medium text-[var(--text-primary)]">
                    Question {validIndex + 1} of {questions.length}
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
                                    className="w-full bg-[var(--bg)]/70 border border-[var(--border)]/60 rounded-xl p-4 text-sm text-[var(--text-primary)] placeholder-[var(--text-secondary)] focus:outline-none focus:ring-2 focus:ring-blue-500/50 min-h-[120px] transition-all resize-none shadow-inner"
                                    placeholder="Type your answer..."
                                    value={answers[q.id]?.text || ''}
                                    onChange={(e) => handleAnswerChange(q.id, e.target.value)}
                                />
                                
                                {answers[q.id]?.audio && (
                                    <div className="mt-3 flex items-center gap-2 bg-[var(--bg)]/70 p-2 rounded-xl border border-[var(--border)]/60">
                                        <audio src={answers[q.id].audio} controls className="h-8 w-full" />
                                        <button 
                                            onClick={() => {
                                                const newAns = { ...answers[q.id] };
                                                delete newAns.audio;
                                                setAnswers(prev => ({ ...prev, [q.id]: newAns }));
                                                onDraftUpdate(q.id, newAns);
                                            }}
                                            className="text-red-400 hover:text-red-300 font-bold px-2"
                                        >
                                            ×
                                        </button>
                                    </div>
                                )}

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
                            </div>
                        </div>
                    )}

                    {(q.type === 'mc' || q.type === 'poll') && (
                        <div className="flex flex-col gap-3">
                            {q.options?.map(opt => (
                                <label key={opt} className={`flex items-center gap-4 p-4 border rounded-xl cursor-pointer transition-all ${answers[q.id]?.text === opt ? 'bg-blue-500/10 border-blue-400 shadow-[0_0_15px_rgba(59,130,246,0.15)]' : 'bg-[var(--bg)]/70 border-[var(--border)]/60 hover:bg-[var(--elevated)]'}`}>
                                    <div className={`w-5 h-5 rounded-full border-2 flex items-center justify-center transition-colors ${answers[q.id]?.text === opt ? 'border-blue-400' : 'border-[var(--border-bright)]/80'}`}>
                                        {answers[q.id]?.text === opt && <div className="w-2.5 h-2.5 rounded-full bg-blue-400" />}
                                    </div>
                                    <input 
                                        type="radio" 
                                        name={`q-${q.id}`} 
                                        checked={answers[q.id]?.text === opt}
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
                                    height="100%"
                                    language={q.language || 'javascript'}
                                    theme="vs-dark"
                                    value={answers[q.id]?.text ?? q.starterCode ?? ''}
                                    onChange={(val) => handleAnswerChange(q.id, val || '')}
                                    onMount={handleEditorMount}
                                    options={{ minimap: { enabled: false }, fontSize: 14, padding: { top: 16 } }}
                                />
                            </div>
                            <div className="flex justify-between items-center mt-2 px-1">
                                <span className="text-[10px] text-[var(--text-primary)] tracking-widest uppercase bg-[var(--elevated)] px-3 py-1 rounded-full border border-[var(--border)]/60">{q.language}</span>
                                <button 
                                    onClick={() => runCode(q.id, answers[q.id]?.text ?? q.starterCode ?? '', q.language || 'javascript')}
                                    className="bg-green-500/10 text-green-400 border border-green-500/30 px-5 py-2 rounded-xl font-bold text-sm hover:bg-green-500/20 transition-colors flex items-center gap-2"
                                >
                                    ▶ Run Code
                                </button>
                            </div>
                            {answers[q.id]?.output && (
                                <div className="mt-3 p-4 bg-[var(--bg)]/80 border border-[var(--border)] rounded-xl font-mono text-[13px] text-green-400/90 whitespace-pre-wrap max-h-48 overflow-y-auto shadow-inner custom-scrollbar">
                                    {answers[q.id]?.output}
                                </div>
                            )}
                        </div>
                    )}

                    <div className="mt-6 flex items-center justify-between">
                        {feedback[q.id] ? (
                            <div className={`px-4 py-2 rounded-xl font-bold text-sm flex items-center gap-2 ${feedback[q.id].status === 'correct' ? 'bg-green-500/20 text-green-400 border border-green-500/30' : 'bg-red-500/20 text-red-400 border border-red-500/30'}`}>
                                {feedback[q.id].status === 'correct' ? '✓ Correct!' : '✗ Incorrect'}
                            </div>
                        ) : (
                            <div />
                        )}
                        <button 
                            onClick={() => handleSubmit(q.id)}
                            className="bg-gradient-to-r from-blue-600 to-indigo-600 text-[var(--text-primary)] font-bold px-8 py-2.5 rounded-xl shadow-lg hover:shadow-blue-500/25 hover:from-blue-500 hover:to-indigo-500 transition-all active:scale-[0.98]"
                        >
                            Submit Answer
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
