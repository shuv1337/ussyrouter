export interface QuotaCheck {
  allowed: boolean;
  remainingCents: number;
  reason?: string;
}

export interface QuotaUsage {
  budgetCents: number;
  spentCents: number;
  remainingCents: number;
}

// Adapter interface - implement different strategies
export interface QuotaAdapter {
  // Check if a key/user can make a request (estimated cost check)
  check(keyId: number, estimatedCostCents: number): Promise<QuotaCheck>;

  // Record actual usage after a request completes
  record(
    keyId: number,
    userId: string,
    costCents: number,
    model: string,
    inputTokens: number,
    outputTokens: number,
    endpoint: string
  ): Promise<void>;

  // Get usage stats for a user
  getUserUsage(userId: string): Promise<QuotaUsage>;

  // Get usage stats for a key
  getKeyUsage(keyId: number): Promise<QuotaUsage>;

  // Get usage stats for a guild/server budget
  getGuildUsage(guildId: string): Promise<QuotaUsage>;
}
