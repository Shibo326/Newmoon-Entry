/**
 * NightGuard AI Security Agent.
 * Screens transactions before signing using Fireworks AI inference.
 * Detects phishing, unlimited approvals, contract risk, behavioral anomalies,
 * and potential NightScore impact.
 *
 * Topics:
 *   - guard.screen-transaction: Full transaction security assessment
 *   - guard.check-phishing: URL/address phishing check
 *   - guard.assess-score-impact: Predict how a TX might affect credit score
 */

import { v4 as uuidv4 } from 'uuid';
import type { Agent, AgentHealth, AgentCapability, AgentLifecycleState } from '../types/agent.js';
import type { BusMessage, ResponseMessage, ErrorMessage } from '../types/messages.js';
import type { BehaviorProfile } from '../types/config.js';
import type { MessageBus } from '../bus/message-bus.js';
import type {
  FireworksClient,
  TransactionRequest,
  WalletContext,
  SecurityAssessment,
  RiskFactor,
  RiskLevel,
} from '../types/guard.js';

const AGENT_ID = 'guard-agent';
const AGENT_NAME = 'NightGuard Agent';

const SYSTEM_PROMPT = `You are NightGuard, an AI security analyst for a privacy-preserving DeFi credit scoring system called NightScore on the Midnight blockchain.

Your job is to analyze transaction requests and identify security risks. You must respond ONLY with valid JSON matching this schema:

{
  "overallRisk": "low" | "medium" | "high" | "critical",
  "riskScore": number (0-100),
  "factors": [
    {
      "category": "contract_age" | "unlimited_approval" | "known_exploit" | "anomaly" | "phishing" | "high_value" | "score_impact",
      "severity": "low" | "medium" | "high" | "critical",
      "description": "string"
    }
  ],
  "recommendation": "proceed" | "caution" | "block",
  "summary": "string (one sentence human-readable summary)"
}

Rules:
- If contract is < 7 days old → high risk factor
- If approval is unlimited → high risk factor
- If address is not in known interactions → medium risk factor (anomaly)
- If value > 3x average transaction → high risk factor
- If contract is unverified → medium risk factor
- Be concise. Never include raw wallet data in your response.
- Only output JSON, no markdown, no explanation.`;

export class GuardAgent implements Agent {
  readonly id = AGENT_ID;
  readonly name = AGENT_NAME;

  private state: AgentLifecycleState = 'idle';
  private activatedAt: number | null = null;
  private requestCount = 0;
  private errorCount = 0;
  private totalResponseTimeMs = 0;
  private modelId: string = 'accounts/fireworks/models/llama-v3p1-8b-instruct';
  private maxTokens: number = 512;
  private temperatureParam: number = 0.1;

  constructor(
    private readonly bus: MessageBus,
    private readonly fireworks: FireworksClient,
  ) {}

  /** Expose model config for the Fireworks client implementation */
  getModelConfig() {
    return {
      modelId: this.modelId,
      maxTokens: this.maxTokens,
      temperature: this.temperatureParam,
    };
  }

  async handleMessage(message: BusMessage): Promise<ResponseMessage | ErrorMessage> {
    const startTime = Date.now();
    this.requestCount++;

    try {
      let result: ResponseMessage | ErrorMessage;

      switch (message.topic) {
        case 'guard.screen-transaction':
          result = await this.handleScreenTransaction(message);
          break;
        case 'guard.check-phishing':
          result = await this.handleCheckPhishing(message);
          break;
        case 'guard.assess-score-impact':
          result = await this.handleAssessScoreImpact(message);
          break;
        default:
          result = this.createErrorResponse(message, 'UNKNOWN_TOPIC', `Unknown topic: ${message.topic}`);
          break;
      }

      const elapsed = Date.now() - startTime;
      this.totalResponseTimeMs += elapsed;

      if (result.type === 'error') {
        this.errorCount++;
      }

      return result;
    } catch (_err: unknown) {
      this.errorCount++;
      const elapsed = Date.now() - startTime;
      this.totalResponseTimeMs += elapsed;
      const description = _err instanceof Error ? _err.message : 'Unknown internal error';
      return this.createErrorResponse(message, 'INTERNAL_ERROR', description);
    }
  }

  getHealth(): AgentHealth {
    const now = Date.now();
    const uptimeSeconds = this.activatedAt !== null
      ? Math.floor((now - this.activatedAt) / 1000)
      : 0;
    const avgResponseTimeMs = this.requestCount > 0
      ? this.totalResponseTimeMs / this.requestCount
      : 0;

    return {
      state: this.state,
      uptimeSeconds,
      requestCount: this.requestCount,
      errorCount: this.errorCount,
      avgResponseTimeMs,
    };
  }

  getCapabilities(): AgentCapability[] {
    return [
      { topic: 'guard.screen-transaction', description: 'AI-powered transaction security screening' },
      { topic: 'guard.check-phishing', description: 'Check URL/address for phishing patterns' },
      { topic: 'guard.assess-score-impact', description: 'Predict transaction impact on NightScore' },
    ];
  }

  async initialize(profile: BehaviorProfile): Promise<void> {
    if (profile.parameters['modelId'] !== undefined) {
      this.modelId = profile.parameters['modelId'] as string;
    }
    if (profile.parameters['maxTokens'] !== undefined) {
      this.maxTokens = profile.parameters['maxTokens'] as number;
    }
    if (profile.parameters['temperature'] !== undefined) {
      this.temperatureParam = profile.parameters['temperature'] as number;
    }
  }

  async onActivate(): Promise<void> {
    this.state = 'active';
    this.activatedAt = Date.now();
  }

  async onDeactivate(): Promise<void> {
    this.state = 'idle';
  }

  async onConfigUpdate(profile: BehaviorProfile): Promise<void> {
    if (profile.parameters['modelId'] !== undefined) {
      this.modelId = profile.parameters['modelId'] as string;
    }
    if (profile.parameters['maxTokens'] !== undefined) {
      this.maxTokens = profile.parameters['maxTokens'] as number;
    }
    if (profile.parameters['temperature'] !== undefined) {
      this.temperatureParam = profile.parameters['temperature'] as number;
    }
  }

  // --- Private Handlers ---

  private async handleScreenTransaction(message: BusMessage): Promise<ResponseMessage | ErrorMessage> {
    const payload = message.payload as { transaction?: TransactionRequest; context?: WalletContext };

    if (!payload.transaction) {
      return this.createErrorResponse(message, 'INVALID_INPUT', 'Missing transaction data in payload');
    }

    const tx = payload.transaction;
    const ctx = payload.context;

    // Build the analysis prompt
    const prompt = this.buildScreeningPrompt(tx, ctx);

    // Call Fireworks AI
    const aiResponse = await this.fireworks.analyze(prompt, SYSTEM_PROMPT);

    // Parse the response
    const assessment = this.parseAssessment(aiResponse);

    // Publish security event (privacy-safe: only risk metadata)
    await this.bus.publish({
      id: uuidv4(),
      sourceAgentId: this.id,
      targetAgentId: null,
      type: 'event',
      correlationId: message.correlationId,
      timestamp: Date.now(),
      topic: 'guard.assessment-complete',
      payload: {
        riskLevel: assessment.overallRisk,
        riskScore: assessment.riskScore,
        recommendation: assessment.recommendation,
        factorCount: assessment.factors.length,
      },
    });

    return this.createResponse(message, { assessment });
  }

  private async handleCheckPhishing(message: BusMessage): Promise<ResponseMessage | ErrorMessage> {
    const payload = message.payload as { url?: string; address?: string };

    if (!payload.url && !payload.address) {
      return this.createErrorResponse(message, 'INVALID_INPUT', 'Provide url or address to check');
    }

    const prompt = `Analyze this for phishing risk:
${payload.url ? `URL: ${payload.url}` : ''}
${payload.address ? `Address: ${payload.address}` : ''}

Check for:
- Typosquatting (similar to known DeFi protocols)
- Suspicious TLD or subdomain patterns
- Known scam address patterns
- Newly registered domains

Respond with the JSON assessment.`;

    const aiResponse = await this.fireworks.analyze(prompt, SYSTEM_PROMPT);
    const assessment = this.parseAssessment(aiResponse);

    return this.createResponse(message, { assessment });
  }

  private async handleAssessScoreImpact(message: BusMessage): Promise<ResponseMessage | ErrorMessage> {
    const payload = message.payload as { transaction?: TransactionRequest; currentGrade?: string };

    if (!payload.transaction) {
      return this.createErrorResponse(message, 'INVALID_INPUT', 'Missing transaction data');
    }

    const prompt = `Assess how this transaction might impact a DeFi credit score:
- Transaction type: ${payload.transaction.functionName || 'transfer'}
- To contract verified: ${payload.transaction.isVerified ?? 'unknown'}
- Current grade: ${payload.currentGrade || 'unknown'}
- Is approval: ${payload.transaction.isApproval || false}

Consider:
- Will this increase or decrease creditworthiness?
- Does interacting with unverified contracts hurt reputation?
- Do approvals expose collateral risk?
- Does the transaction show responsible DeFi behavior?

Focus on the score_impact category in your factors.
Respond with JSON assessment.`;

    const aiResponse = await this.fireworks.analyze(prompt, SYSTEM_PROMPT);
    const assessment = this.parseAssessment(aiResponse);

    return this.createResponse(message, { assessment });
  }

  // --- Helpers ---

  private buildScreeningPrompt(tx: TransactionRequest, ctx?: WalletContext): string {
    const lines: string[] = [
      'Analyze this transaction for security risks:',
      '',
      `To: ${tx.to}`,
      `From: ${tx.from}`,
    ];

    if (tx.value) lines.push(`Value: ${tx.value}`);
    if (tx.contractName) lines.push(`Contract: ${tx.contractName}`);
    if (tx.contractAge !== undefined) lines.push(`Contract age: ${tx.contractAge} days`);
    if (tx.isVerified !== undefined) lines.push(`Verified: ${tx.isVerified}`);
    if (tx.functionName) lines.push(`Function: ${tx.functionName}`);
    if (tx.isApproval) lines.push(`Approval: yes, amount: ${tx.approvalAmount || 'unknown'}`);

    if (ctx) {
      lines.push('');
      lines.push('Wallet context:');
      const isKnown = ctx.knownInteractions.includes(tx.to);
      lines.push(`- Previously interacted with this address: ${isKnown}`);
      if (ctx.averageTransactionValue) {
        lines.push(`- Average transaction value: ${ctx.averageTransactionValue}`);
      }
      if (ctx.currentGrade) {
        lines.push(`- Current credit grade: ${ctx.currentGrade}`);
      }
    }

    lines.push('');
    lines.push('Respond with JSON assessment only.');

    return lines.join('\n');
  }

  private parseAssessment(aiResponse: string): SecurityAssessment {
    try {
      // Try to extract JSON from the response
      const jsonMatch = aiResponse.match(/\{[\s\S]*\}/);
      if (!jsonMatch) {
        return this.fallbackAssessment('Could not parse AI response');
      }

      const parsed = JSON.parse(jsonMatch[0]) as Partial<SecurityAssessment>;

      // Validate and sanitize
      const validRisks: RiskLevel[] = ['low', 'medium', 'high', 'critical'];
      const overallRisk = validRisks.includes(parsed.overallRisk as RiskLevel)
        ? (parsed.overallRisk as RiskLevel)
        : 'medium';

      const riskScore = typeof parsed.riskScore === 'number'
        ? Math.max(0, Math.min(100, parsed.riskScore))
        : 50;

      const factors: RiskFactor[] = Array.isArray(parsed.factors)
        ? parsed.factors.slice(0, 10)
        : [];

      const validRecs = ['proceed', 'caution', 'block'] as const;
      const recommendation = validRecs.includes(parsed.recommendation as typeof validRecs[number])
        ? (parsed.recommendation as 'proceed' | 'caution' | 'block')
        : 'caution';

      return {
        overallRisk,
        riskScore,
        factors,
        recommendation,
        summary: typeof parsed.summary === 'string' ? parsed.summary.slice(0, 200) : 'Assessment complete',
        timestamp: Date.now(),
      };
    } catch {
      return this.fallbackAssessment('Failed to parse AI response');
    }
  }

  private fallbackAssessment(reason: string): SecurityAssessment {
    return {
      overallRisk: 'medium',
      riskScore: 50,
      factors: [{
        category: 'anomaly',
        severity: 'medium',
        description: reason,
      }],
      recommendation: 'caution',
      summary: 'Could not complete full analysis — proceed with caution',
      timestamp: Date.now(),
    };
  }

  private createResponse(originalMessage: BusMessage, payload: Record<string, unknown>): ResponseMessage {
    return {
      id: uuidv4(),
      sourceAgentId: this.id,
      targetAgentId: originalMessage.sourceAgentId,
      type: 'response',
      correlationId: originalMessage.correlationId,
      timestamp: Date.now(),
      topic: originalMessage.topic,
      payload,
    };
  }

  private createErrorResponse(originalMessage: BusMessage, code: string, description: string): ErrorMessage {
    return {
      id: uuidv4(),
      sourceAgentId: this.id,
      targetAgentId: originalMessage.sourceAgentId,
      type: 'error',
      correlationId: originalMessage.correlationId,
      timestamp: Date.now(),
      topic: originalMessage.topic,
      payload: { code, description },
    };
  }
}

export default GuardAgent;
