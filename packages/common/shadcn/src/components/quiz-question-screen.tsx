/**
 * Copyright Discava Contributors. All Rights Reserved.
 * SPDX-License-Identifier: Apache-2.0
 */

import type {
  QuestionMarker,
  QuizQuestion,
} from '@discava/common-web-utils/quiz';
import { useId } from 'react';
import { QuizMarkerBadge } from './quiz-marker-badge';
import { RichTextView } from './rich-text-view';
import { Checkbox } from './ui/checkbox';
import { Label } from './ui/label';
import { RadioGroup, RadioGroupItem } from './ui/radio-group';

export function QuestionScreen({
  question,
  options,
  number,
  total,
  answer,
  marker,
  onAnswer,
}: {
  question: QuizQuestion;
  options: QuizQuestion['options'];
  number: number;
  total: number;
  answer: string[];
  marker?: QuestionMarker;
  onAnswer: (optionIds: string[]) => void;
}) {
  const id = useId();
  const multiple = question.kind === 'multiple';
  return (
    <fieldset aria-labelledby={`${id}-legend`} className="space-y-4">
      <div id={`${id}-legend`} className="space-y-2">
        <p className="flex items-center gap-2 text-xs font-medium text-muted-foreground">
          Question {number} of {total} <QuizMarkerBadge marker={marker} />
        </p>
        <RichTextView value={question.prompt} className="prose-base" />
        {multiple ? (
          <p className="text-sm font-medium">Select all that apply</p>
        ) : null}
      </div>
      <QuestionOptions
        idPrefix={id}
        multiple={multiple}
        options={options}
        answer={answer}
        onAnswer={onAnswer}
      />
    </fieldset>
  );
}

// The options of a question as checkboxes (select all that apply) or radios.
export function QuestionOptions({
  idPrefix: id,
  multiple,
  options,
  answer,
  disabled,
  onAnswer,
}: {
  idPrefix: string;
  multiple: boolean;
  options: QuizQuestion['options'];
  answer: string[];
  disabled?: boolean;
  onAnswer: (optionIds: string[]) => void;
}) {
  return multiple ? (
    <div className="grid gap-2">
      {options.map((option) => (
        <Label
          key={option.optionId}
          htmlFor={`${id}-${option.optionId}`}
          className="cursor-pointer gap-3 rounded-lg border px-3.5 py-2.5 font-normal leading-normal hover:bg-muted/50 has-[[data-state=checked]]:border-primary has-[[data-state=checked]]:bg-primary/5"
        >
          <Checkbox
            disabled={disabled}
            id={`${id}-${option.optionId}`}
            checked={answer.includes(option.optionId)}
            onCheckedChange={(checked) =>
              onAnswer(
                checked
                  ? [...answer, option.optionId]
                  : answer.filter((o) => o !== option.optionId),
              )
            }
          />
          {option.text}
        </Label>
      ))}
    </div>
  ) : (
    <RadioGroup
      disabled={disabled}
      className="gap-2"
      value={answer[0] ?? ''}
      onValueChange={(optionId) => onAnswer([optionId])}
    >
      {options.map((option) => (
        <Label
          key={option.optionId}
          htmlFor={`${id}-${option.optionId}`}
          className="cursor-pointer gap-3 rounded-lg border px-3.5 py-2.5 font-normal leading-normal hover:bg-muted/50 has-[[data-state=checked]]:border-primary has-[[data-state=checked]]:bg-primary/5"
        >
          <RadioGroupItem
            id={`${id}-${option.optionId}`}
            value={option.optionId}
          />
          {option.text}
        </Label>
      ))}
    </RadioGroup>
  );
}
