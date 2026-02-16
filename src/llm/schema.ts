/**
 * Zod schema mirroring `ArchitectureImpactReport` from src/types/index.ts.
 * Used to validate Gemini's JSON response before it's trusted by the rest of
 * the pipeline (diagrams/report modules) — an LLM returning slightly-wrong
 * JSON should fail loudly here rather than silently propagate.
 *
 * Keep this in lockstep with `ArchitectureImpactReport`. It's intentionally
 * duplicated rather than derived from the TS type (zod can't introspect a
 * `.ts` interface at runtime), so if that interface changes, update this too.
 */
import { z } from 'zod';

export const severitySchema = z.enum(['low', 'medium', 'high']);

export const architectureImpactReportSchema = z.object({
  summary: z.string(),
  affectedComponents: z.array(
    z.object({
      name: z.string(),
      reason: z.string(),
    })
  ),
  affectedApis: z.array(
    z.object({
      endpoint: z.string(),
      impact: z.string(),
    })
  ),
  databaseChanges: z.array(
    z.object({
      description: z.string(),
      migrationNotes: z.string(),
    })
  ),
  newComponents: z.array(
    z.object({
      name: z.string(),
      purpose: z.string(),
    })
  ),
  scalabilityRisks: z.array(
    z.object({
      risk: z.string(),
      severity: severitySchema,
      mitigation: z.string(),
    })
  ),
  securityConcerns: z.array(
    z.object({
      concern: z.string(),
      severity: severitySchema,
      mitigation: z.string(),
    })
  ),
  recommendedSteps: z.array(z.string()),
});

export type ArchitectureImpactReportShape = z.infer<typeof architectureImpactReportSchema>;
