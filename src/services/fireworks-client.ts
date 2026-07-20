/**
 * Fireworks AI HTTP Client.
 * OpenAI-compatible chat completions API for NightGuard security screening.
 * 
 * Uses the standard OpenAI format:
 *   POST https://api.fireworks.ai/inference/v1/chat/completions
 */

import type { FireworksClient } from '../types/guard.js';

const FIREWORKS_API_URL = 'https://api.fireworks.ai/inference/v1/chat/completions';

export interface FireworksClientConfig {
  apiKey: string;
  model?: string;
  maxTokens?: number;
  temperature?: number;
}

export class FireworksHttpClient implements FireworksClient {
  private readonly apiKey: string;
  private readonly model: string;
  private readonly maxTokens: number;
  private readonly temperature: number;

  constructor(config: FireworksClientConfig) {
    if (!config.apiKey) {
      throw new Error('Fireworks API key is required');
    }
    this.apiKey = config.apiKey;
    this.model = config.model ?? 'accounts/fireworks/models/llama-v3p1-8b-instruct';
    this.maxTokens = config.maxTokens ?? 512;
    this.temperature = config.temperature ?? 0.1;
  }

  async analyze(prompt: string, systemPrompt: string): Promise<string> {
    const body = {
      model: this.model,
      messages: [
        { role: 'system', content: systemPrompt },
        { role: 'user', content: prompt },
      ],
      max_tokens: this.maxTokens,
      temperature: this.temperature,
      response_format: { type: 'json_object' },
    };

    const response = await fetch(FIREWORKS_API_URL, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${this.apiKey}`,
      },
      body: JSON.stringify(body),
    });

    if (!response.ok) {
      const errorText = await response.text();
      throw new Error(`Fireworks API error (${response.status}): ${errorText}`);
    }

    const data = await response.json() as {
      choices?: Array<{ message?: { content?: string } }>;
    };

    const content = data.choices?.[0]?.message?.content;
    if (!content) {
      throw new Error('Empty response from Fireworks AI');
    }

    return content;
  }
}

/**
 * Factory: create a FireworksClient from environment variables.
 */
export function createFireworksClient(overrides?: Partial<FireworksClientConfig>): FireworksHttpClient {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const env = (globalThis as any).process?.env ?? {};
  const apiKey = overrides?.apiKey ?? (env.FIREWORKS_API_KEY as string) ?? '';
  return new FireworksHttpClient({
    apiKey,
    model: overrides?.model,
    maxTokens: overrides?.maxTokens,
    temperature: overrides?.temperature,
  });
}
