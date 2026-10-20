/**
 * Copyright Discava Contributors. All Rights Reserved.
 * SPDX-License-Identifier: Apache-2.0
 */
import { z } from 'zod';
import { CurriculumVisibilitySchema } from './visibility.js';

export const ModuleSchema = z.object({
  moduleId: z.string(),
  courseId: z.string(),
  title: z.string(),
  description: z.string().optional(),
  order: z.number(),
  visibility: CurriculumVisibilitySchema,
  archivedAt: z.string().optional(),
  publishedAt: z.string().optional(),
  createdAt: z.string(),
  updatedAt: z.string(),
});

export type IModule = z.output<typeof ModuleSchema>;

export const CreateModuleInputSchema = z.object({
  courseId: z.string(),
  title: z.string().min(1).max(200),
  description: z.string().optional(),
});

export type ICreateModuleInput = z.output<typeof CreateModuleInputSchema>;

export const CreateModuleOutputSchema = ModuleSchema;

export type ICreateModuleOutput = z.output<typeof CreateModuleOutputSchema>;

export const UpdateModuleInputSchema = z.object({
  courseId: z.string(),
  moduleId: z.string(),
  title: z.string().min(1).max(200).optional(),
  description: z.string().optional(),
});

export type IUpdateModuleInput = z.output<typeof UpdateModuleInputSchema>;

export const UpdateModuleOutputSchema = ModuleSchema;

export type IUpdateModuleOutput = z.output<typeof UpdateModuleOutputSchema>;

export const DeleteModuleInputSchema = z.object({
  courseId: z.string(),
  moduleId: z.string(),
});

export type IDeleteModuleInput = z.output<typeof DeleteModuleInputSchema>;

export const DeleteModuleOutputSchema = ModuleSchema;

export type IDeleteModuleOutput = z.output<typeof DeleteModuleOutputSchema>;

const ModuleKeySchema = z.object({
  courseId: z.string(),
  moduleId: z.string(),
});

export const PublishModuleInputSchema = ModuleKeySchema;

export type IPublishModuleInput = z.output<typeof PublishModuleInputSchema>;

export const PublishModuleOutputSchema = ModuleSchema;

export type IPublishModuleOutput = z.output<typeof PublishModuleOutputSchema>;

export const HideModuleInputSchema = ModuleKeySchema;

export type IHideModuleInput = z.output<typeof HideModuleInputSchema>;

export const HideModuleOutputSchema = ModuleSchema;

export type IHideModuleOutput = z.output<typeof HideModuleOutputSchema>;

export const RestoreModuleInputSchema = ModuleKeySchema;

export type IRestoreModuleInput = z.output<typeof RestoreModuleInputSchema>;

export const RestoreModuleOutputSchema = ModuleSchema;

export type IRestoreModuleOutput = z.output<typeof RestoreModuleOutputSchema>;

export const DeleteModulePermanentlyInputSchema = ModuleKeySchema;

export type IDeleteModulePermanentlyInput = z.output<
  typeof DeleteModulePermanentlyInputSchema
>;

export const DeleteModulePermanentlyOutputSchema = ModuleSchema;

export type IDeleteModulePermanentlyOutput = z.output<
  typeof DeleteModulePermanentlyOutputSchema
>;

export const ReorderModulesInputSchema = z.object({
  courseId: z.string(),
  moduleIds: z.array(z.string()).min(1),
});

export type IReorderModulesInput = z.output<typeof ReorderModulesInputSchema>;

// The course's modules that aren't archived, in their new order.
export const ReorderModulesOutputSchema = z.array(ModuleSchema);

export type IReorderModulesOutput = z.output<typeof ReorderModulesOutputSchema>;
