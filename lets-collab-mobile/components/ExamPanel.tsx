import React, { useEffect, useState } from 'react';
import { KeyboardAvoidingView, Platform, ScrollView, StyleSheet, Text, TextInput, View } from 'react-native';
import { ChevronLeft, ChevronRight, ClipboardList, Minimize2, Send } from 'lucide-react-native';
import { useTheme } from '../context/ThemeContext';
import { AnimatedPressable } from './AnimatedPressable';
import type { ExamAnswer, ExamQuestion } from '../lib/exam/types';

type Props = {
  questions: ExamQuestion[];
  answers: Record<string, ExamAnswer>;
  topInset: number;
  bottomInset: number;
  onChangeText: (question: ExamQuestion, text: string) => void;
  onSelectOption: (question: ExamQuestion, option: string) => void;
  onSubmit: (question: ExamQuestion) => void;
  onSubmitAll: () => void;
  onMinimize: () => void;
};

const TYPE_LABELS: Record<ExamQuestion['type'], string> = {
  freeform: 'WRITTEN',
  mc: 'MULTIPLE CHOICE',
  poll: 'POLL',
  code: 'CODE',
};

/**
 * Mobile counterpart of the web candidate's ExamControllerOverlay: one question at a time with
 * Prev/Next, freeform text, single-choice options (mc/poll) and a plain monospace code editor.
 */
export function ExamPanel({
  questions,
  answers,
  topInset,
  bottomInset,
  onChangeText,
  onSelectOption,
  onSubmit,
  onSubmitAll,
  onMinimize,
}: Props) {
  const { colors } = useTheme();
  const [index, setIndex] = useState(0);
  const validIndex = Math.min(index, Math.max(0, questions.length - 1));
  const question = questions[validIndex];

  useEffect(() => {
    if (index !== validIndex) setIndex(validIndex);
  }, [index, validIndex]);

  if (!question) return null;

  const answer = answers[question.id] || {};
  const codeValue = answer.text ?? question.starterCode ?? '';

  return (
    <KeyboardAvoidingView
      behavior={Platform.OS === 'ios' ? 'padding' : 'height'}
      style={[StyleSheet.absoluteFill, { backgroundColor: colors.bg }]}
    >
      <View style={[styles.header, { paddingTop: topInset + 12, borderBottomColor: colors.border }]}>
        <View style={[styles.iconWrapper, { backgroundColor: 'rgba(0, 212, 255, 0.1)', borderColor: 'rgba(0, 212, 255, 0.25)' }]}>
          <ClipboardList color={colors.accent} size={18} />
        </View>
        <View style={{ flex: 1 }}>
          <Text style={[styles.label, { color: colors.textDim }]}>SUPERVISED EXAM</Text>
          <Text style={[styles.title, { color: colors.textPrimary }]}>Active questions</Text>
        </View>
        <AnimatedPressable
          onPress={onMinimize}
          accessibilityLabel="Show the session"
          style={[styles.headerBtn, { backgroundColor: colors.elevated, borderColor: colors.border }]}
        >
          <Minimize2 color={colors.textSecondary} size={16} />
        </AnimatedPressable>
        <AnimatedPressable
          onPress={onSubmitAll}
          hapticFeedback="medium"
          accessibilityLabel="Submit all answers and close"
          style={[styles.headerBtn, { backgroundColor: 'rgba(255, 59, 92, 0.12)', borderColor: 'rgba(255, 59, 92, 0.35)' }]}
        >
          <Text style={[styles.submitAllText, { color: colors.red }]}>Submit all</Text>
        </AnimatedPressable>
      </View>

      <View style={[styles.pager, { backgroundColor: colors.elevated, borderColor: colors.border }]}>
        <AnimatedPressable
          onPress={() => setIndex(Math.max(0, validIndex - 1))}
          disabled={validIndex === 0}
          accessibilityLabel="Previous question"
          style={[styles.pagerBtn, { borderColor: colors.border, backgroundColor: colors.bg, opacity: validIndex === 0 ? 0.4 : 1 }]}
        >
          <ChevronLeft color={colors.textPrimary} size={18} />
        </AnimatedPressable>
        <Text style={[styles.pagerText, { color: colors.textPrimary }]}>
          Question {validIndex + 1} of {questions.length}
        </Text>
        <AnimatedPressable
          onPress={() => setIndex(Math.min(questions.length - 1, validIndex + 1))}
          disabled={validIndex === questions.length - 1}
          accessibilityLabel="Next question"
          style={[
            styles.pagerBtn,
            { borderColor: colors.border, backgroundColor: colors.bg, opacity: validIndex === questions.length - 1 ? 0.4 : 1 },
          ]}
        >
          <ChevronRight color={colors.textPrimary} size={18} />
        </AnimatedPressable>
      </View>

      <ScrollView
        style={{ flex: 1 }}
        contentContainerStyle={[styles.body, { paddingBottom: bottomInset + 24 }]}
        keyboardShouldPersistTaps="handled"
      >
        <View style={[styles.card, { backgroundColor: colors.surface, borderColor: colors.border }]}>
          <View style={[styles.cardAccent, { backgroundColor: colors.accent }]} />
          <Text style={[styles.label, { color: colors.textDim }]}>
            {TYPE_LABELS[question.type]}
            {question.type === 'code' && question.language ? ` · ${question.language.toUpperCase()}` : ''}
          </Text>
          <Text style={[styles.prompt, { color: colors.textPrimary }]}>{question.prompt}</Text>
          {question.voicePrompt ? (
            <Text style={[styles.hint, { color: colors.textDim }]}>
              This question has a voice prompt. Voice playback is only available in the web app.
            </Text>
          ) : null}

          {question.type === 'freeform' && (
            <TextInput
              value={answer.text || ''}
              onChangeText={text => onChangeText(question, text)}
              placeholder="Type your answer..."
              placeholderTextColor={colors.textDim}
              multiline
              textAlignVertical="top"
              style={[styles.freeform, { color: colors.textPrimary, backgroundColor: colors.bg, borderColor: colors.border }]}
            />
          )}

          {(question.type === 'mc' || question.type === 'poll') && (
            <View style={styles.options}>
              {(question.options || []).map(option => {
                const selected = answer.text === option;
                return (
                  <AnimatedPressable
                    key={option}
                    onPress={() => onSelectOption(question, option)}
                    hapticFeedback="selection"
                    scaleValue={0.98}
                    accessibilityRole="radio"
                    accessibilityState={{ selected }}
                    style={[
                      styles.option,
                      selected
                        ? { backgroundColor: 'rgba(0, 212, 255, 0.1)', borderColor: colors.accent }
                        : { backgroundColor: colors.bg, borderColor: colors.border },
                    ]}
                  >
                    <View style={[styles.radio, { borderColor: selected ? colors.accent : colors.borderBright }]}>
                      {selected && <View style={[styles.radioDot, { backgroundColor: colors.accent }]} />}
                    </View>
                    <Text style={[styles.optionText, { color: colors.textPrimary }]}>{option}</Text>
                  </AnimatedPressable>
                );
              })}
            </View>
          )}

          {question.type === 'code' && (
            <>
              <TextInput
                value={codeValue}
                onChangeText={text => onChangeText(question, text)}
                multiline
                textAlignVertical="top"
                autoCapitalize="none"
                autoCorrect={false}
                autoComplete="off"
                spellCheck={false}
                smartInsertDelete={false}
                keyboardType={Platform.OS === 'ios' ? 'ascii-capable' : 'visible-password'}
                scrollEnabled={false}
                style={[styles.code, { color: colors.textPrimary, backgroundColor: '#0b0b14', borderColor: colors.border }]}
              />
              <Text style={[styles.hint, { color: colors.textDim }]}>
                Your code is streamed live to the invigilator. Running code is only available in the web app.
              </Text>
            </>
          )}

          <AnimatedPressable
            onPress={() => onSubmit(question)}
            hapticFeedback="medium"
            style={[styles.submitBtn, { backgroundColor: colors.accent }]}
          >
            <Send color="#080810" size={16} />
            <Text style={styles.submitText}>Submit answer</Text>
          </AnimatedPressable>
        </View>
      </ScrollView>
    </KeyboardAvoidingView>
  );
}

const styles = StyleSheet.create({
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    paddingHorizontal: 16,
    paddingBottom: 12,
    borderBottomWidth: 1,
  },
  iconWrapper: {
    width: 36,
    height: 36,
    borderRadius: 8,
    borderWidth: 1,
    justifyContent: 'center',
    alignItems: 'center',
  },
  label: {
    fontFamily: 'SpaceMono',
    fontSize: 10,
    letterSpacing: 1.5,
    marginBottom: 2,
  },
  title: {
    fontFamily: 'Inter_900Black',
    fontSize: 18,
  },
  headerBtn: {
    height: 36,
    minWidth: 36,
    paddingHorizontal: 10,
    borderRadius: 10,
    borderWidth: 1,
    justifyContent: 'center',
    alignItems: 'center',
  },
  submitAllText: {
    fontFamily: 'Inter_700Bold',
    fontSize: 12,
  },
  pager: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginHorizontal: 16,
    marginTop: 12,
    padding: 8,
    borderRadius: 12,
    borderWidth: 1,
  },
  pagerBtn: {
    width: 36,
    height: 32,
    borderRadius: 8,
    borderWidth: 1,
    justifyContent: 'center',
    alignItems: 'center',
  },
  pagerText: {
    fontFamily: 'Inter_600SemiBold',
    fontSize: 13,
  },
  body: {
    padding: 16,
  },
  card: {
    borderRadius: 16,
    borderWidth: 1,
    padding: 16,
    paddingLeft: 20,
    overflow: 'hidden',
    gap: 12,
  },
  cardAccent: {
    position: 'absolute',
    left: 0,
    top: 0,
    bottom: 0,
    width: 3,
    opacity: 0.6,
  },
  prompt: {
    fontFamily: 'Inter_600SemiBold',
    fontSize: 15,
    lineHeight: 22,
  },
  hint: {
    fontFamily: 'Inter_500Medium',
    fontSize: 12,
    lineHeight: 17,
  },
  freeform: {
    minHeight: 140,
    borderRadius: 12,
    borderWidth: 1,
    padding: 12,
    fontFamily: 'Inter_500Medium',
    fontSize: 14,
  },
  options: {
    gap: 10,
  },
  option: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    padding: 14,
    borderRadius: 12,
    borderWidth: 1,
  },
  radio: {
    width: 20,
    height: 20,
    borderRadius: 10,
    borderWidth: 2,
    justifyContent: 'center',
    alignItems: 'center',
  },
  radioDot: {
    width: 10,
    height: 10,
    borderRadius: 5,
  },
  optionText: {
    flex: 1,
    fontFamily: 'Inter_500Medium',
    fontSize: 14,
  },
  code: {
    minHeight: 260,
    borderRadius: 12,
    borderWidth: 1,
    padding: 12,
    fontFamily: 'SpaceMono',
    fontSize: 13,
    lineHeight: 19,
  },
  submitBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
    paddingVertical: 14,
    borderRadius: 12,
    marginTop: 4,
  },
  submitText: {
    color: '#080810',
    fontFamily: 'Inter_700Bold',
    fontSize: 14,
  },
});
