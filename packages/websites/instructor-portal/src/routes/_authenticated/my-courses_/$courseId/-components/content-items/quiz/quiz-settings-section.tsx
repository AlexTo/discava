/**
 * Copyright Discava Contributors. All Rights Reserved.
 * SPDX-License-Identifier: Apache-2.0
 */

import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
} from '@discava/common-shadcn/components/ui/card';
import { Checkbox } from '@discava/common-shadcn/components/ui/checkbox';
import { Input } from '@discava/common-shadcn/components/ui/input';
import { Label } from '@discava/common-shadcn/components/ui/label';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@discava/common-shadcn/components/ui/select';
import { Textarea } from '@discava/common-shadcn/components/ui/textarea';
import { useId } from 'react';
import type { QuizState, RevealAnswers } from './quiz-form';
import { sectionId } from './use-quiz-builder-state';

const REVEAL_LABELS: Record<RevealAnswers, string> = {
  after_each_attempt: 'After each attempt',
  after_final_attempt: 'After the last attempt',
  never: 'Never',
};

export function QuizSettingsSection({
  quiz,
  readOnly,
  onChange,
  onChangeSettings,
}: {
  quiz: QuizState;
  readOnly: boolean;
  onChange: (next: Partial<QuizState>) => void;
  onChangeSettings: (next: Partial<QuizState['settings']>) => void;
}) {
  // Prefix for the settings fields' ids, which their labels point at.
  const ids = useId();
  return (
    <section
      id={sectionId('settings')}
      aria-labelledby="quiz-settings"
      className="scroll-mt-4"
    >
      <Card className="gap-4 p-5">
        <CardHeader className="px-0">
          <CardTitle>
            <h2 id="quiz-settings" className="text-lg">
              Settings
            </h2>
          </CardTitle>
        </CardHeader>
        <CardContent className="px-0">
          <fieldset disabled={readOnly} className="grid gap-4 sm:grid-cols-2">
            <div className="space-y-1.5 sm:col-span-2">
              <Label htmlFor={`${ids}-title`}>Title</Label>
              <Input
                id={`${ids}-title`}
                value={quiz.title}
                onChange={(event) => onChange({ title: event.target.value })}
                maxLength={200}
              />
            </div>
            <div className="space-y-1.5 sm:col-span-2">
              <Label htmlFor={`${ids}-description`}>
                Description (optional)
              </Label>
              <Textarea
                id={`${ids}-description`}
                value={quiz.description}
                onChange={(event) =>
                  onChange({ description: event.target.value })
                }
                rows={2}
              />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor={`${ids}-pass-mark`}>Pass mark (%)</Label>
              <Input
                id={`${ids}-pass-mark`}
                type="number"
                min={0}
                max={100}
                step={1}
                value={
                  Number.isNaN(quiz.settings.passMarkPercent)
                    ? ''
                    : quiz.settings.passMarkPercent
                }
                onChange={(event) =>
                  onChangeSettings({
                    passMarkPercent: event.target.valueAsNumber,
                  })
                }
              />
            </div>
            <div className="space-y-1.5">
              <span className="text-sm font-medium">Attempts allowed</span>
              <div className="flex h-9 items-center gap-3">
                <div className="flex items-center gap-2">
                  <Checkbox
                    id={`${ids}-unlimited`}
                    checked={quiz.settings.attemptsAllowed === null}
                    onCheckedChange={(checked) =>
                      onChangeSettings({
                        attemptsAllowed: checked === true ? null : 3,
                      })
                    }
                    disabled={readOnly}
                  />
                  <Label htmlFor={`${ids}-unlimited`} className="font-normal">
                    Unlimited
                  </Label>
                </div>
                {quiz.settings.attemptsAllowed !== null && (
                  <Input
                    type="number"
                    min={1}
                    step={1}
                    aria-label="Number of attempts"
                    className="w-24"
                    value={
                      Number.isNaN(quiz.settings.attemptsAllowed)
                        ? ''
                        : quiz.settings.attemptsAllowed
                    }
                    onChange={(event) =>
                      onChangeSettings({
                        attemptsAllowed: event.target.valueAsNumber,
                      })
                    }
                  />
                )}
              </div>
            </div>
            <div className="space-y-1.5">
              <Label htmlFor={`${ids}-reveal`}>Show the correct answers</Label>
              <Select
                value={quiz.settings.revealAnswers}
                onValueChange={(value) =>
                  onChangeSettings({
                    revealAnswers: value as RevealAnswers,
                  })
                }
                disabled={readOnly}
              >
                <SelectTrigger id={`${ids}-reveal`} className="w-full">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {Object.entries(REVEAL_LABELS).map(([value, label]) => (
                    <SelectItem key={value} value={value}>
                      {label}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="flex items-center gap-2 self-end sm:h-9">
              <Checkbox
                id={`${ids}-shuffle`}
                checked={quiz.settings.shuffleOptions}
                onCheckedChange={(checked) =>
                  onChangeSettings({ shuffleOptions: checked === true })
                }
                disabled={readOnly}
              />
              <Label htmlFor={`${ids}-shuffle`} className="font-normal">
                Shuffle the options for each student
              </Label>
            </div>
          </fieldset>
        </CardContent>
      </Card>
    </section>
  );
}
