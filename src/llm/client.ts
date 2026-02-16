/**
 * Gemini client wiring + JSON parse/validate/retry logic for
 * `generateImpactReport`.
 */
import { GoogleGenerativeAI } from '@google/generative-ai';
import { ZodError } from 'zod';
import { loadConfig } from '../config/index.js';
import { withGeminiRetry } from '../config/gemini-retry.js';
import type { ArchitectureImpactReport, ArchitectureInventory, ChangeProposal, RetrievalResult } from '../types/index.js';
import { buildImpactReportPrompt } from './prompt.js';
import { architectureImpactReportSchema } from './schema.js';

/** Minimal surface of `GenerativeModel` we depend on — kept narrow so tests can inject a fake without mocking `@google/generative-ai` internals. */
export interface GenerativeContentClient {
  generateContent(prompt: string): Promise<{ response: { text(): string } }>;
}

let cachedClient: GenerativeContentClient | undefined;

function getDefaultGenerativeClient(): GenerativeContentClient {
  if (!cachedClient) {
    const config = loadConfig();
    const genAI = new GoogleGenerativeAI(config.geminiApiKey);
    cachedClient = genAI.getGenerativeModel({
      model: config.geminiModel,
      generationConfig: {
        // Ask Gemini natively for JSON output. We still defensively strip
        // markdown fences and validate below, since the model can ignore
        // this on malformed/edge-case prompts.
        responseMimeType: 'application/json',
      },
    });
  }
  return cachedClient;
}

/** Strips a ```json ... ``` / ``` ... ``` fence wrapper if the whole response is wrapped in one, then parses JSON. */
function extractJson(rawText: string): unknown {
  const trimmed = rawText.trim();
  const fenceMatch = trimmed.match(/^```(?:json)?\s*([\s\S]*?)\s*```$/i);
  const jsonText = fenceMatch ? fenceMatch[1] : trimmed;
  return JSON.parse(jsonText);
}

export interface GenerateImpactReportParams {
  proposal: ChangeProposal;
  inventory: ArchitectureInventory;
  retrievedContext: RetrievalResult[];
}

/**
 * Generates an `ArchitectureImpactReport` from Gemini. Builds one structured
 * prompt (proposal + condensed inventory + retrieved chunks), asks for JSON
 * only, and validates the result against `architectureImpactReportSchema`.
 * On a parse or validation failure, retries once with an added "return only
 * valid JSON" instruction; if that also fails, throws a clear error
 * describing both failures.
 *
 * `client` is injectable for tests; production callers should omit it and
 * let a lazily-constructed real Gemini client be used.
 */
export async function generateImpactReport(
  params: GenerateImpactReportParams,
  client: GenerativeContentClient = getDefaultGenerativeClient()
): Promise<ArchitectureImpactReport> {
  const attempt = async (strict: boolean): Promise<ArchitectureImpactReport> => {
    const prompt = buildImpactReportPrompt(params, strict);
    const result = await withGeminiRetry(() => client.generateContent(prompt), 'generateContent');
    const rawText = result.response.text();
    const json = extractJson(rawText);
    return architectureImpactReportSchema.parse(json);
  };

  try {
    return await attempt(false);
  } catch (firstErr) {
    try {
      return await attempt(true);
    } catch (secondErr) {
      throw new Error(
        'generateImpactReport: Gemini did not return JSON matching ArchitectureImpactReport, even after a ' +
          `retry with a stricter "JSON only" instruction.\n` +
          `First attempt error: ${describeError(firstErr)}\n` +
          `Retry attempt error: ${describeError(secondErr)}`
      );
    }
  }
}

function describeError(err: unknown): string {
  if (err instanceof ZodError) return `schema validation failed: ${err.message}`;
  if (err instanceof Error) return err.message;
  return String(err);
}
