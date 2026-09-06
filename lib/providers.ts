import { ProviderConfig } from './types';

export const PROVIDERS: Record<string, ProviderConfig> = {
  openai: {
    id: 'openai',
    name: 'OpenAI',
    baseUrl: 'https://api.openai.com/v1',
    authType: 'bearer',
    authPrefix: 'Bearer ',
    isOpenAICompatible: true,
    defaultModels: ['gpt-4o', 'gpt-4o-mini', 'gpt-4-turbo', 'gpt-3.5-turbo', 'o1', 'o1-mini', 'o3-mini'],
    color: '#000000',
    description: 'GPT models, embeddings, and more',
    docsUrl: 'https://platform.openai.com/docs',
  },
  anthropic: {
    id: 'anthropic',
    name: 'Anthropic',
    baseUrl: 'https://api.anthropic.com',
    authType: 'x-api-key',
    authHeader: 'x-api-key',
    isOpenAICompatible: false,
    defaultModels: ['claude-3-5-sonnet-20241022', 'claude-3-5-haiku-20241022', 'claude-3-opus-20240229', 'claude-3-sonnet-20240229', 'claude-3-haiku-20240307'],
    color: '#D4A27F',
    description: 'Claude models for conversation and analysis',
    docsUrl: 'https://docs.anthropic.com',
  },
  google: {
    id: 'google',
    name: 'Google AI',
    baseUrl: 'https://generativelanguage.googleapis.com',
    authType: 'query',
    authQueryParam: 'key',
    isOpenAICompatible: false,
    defaultModels: ['gemini-1.5-pro', 'gemini-1.5-flash', 'gemini-2.0-flash-exp', 'gemini-pro'],
    color: '#4285F4',
    description: 'Gemini models',
    docsUrl: 'https://ai.google.dev',
  },
  groq: {
    id: 'groq',
    name: 'Groq',
    baseUrl: 'https://api.groq.com/openai/v1',
    authType: 'bearer',
    authPrefix: 'Bearer ',
    isOpenAICompatible: true,
    defaultModels: ['llama-3.3-70b-versatile', 'llama-3.1-70b-versatile', 'mixtral-8x7b-32768', 'gemma2-9b-it'],
    color: '#F55036',
    description: 'Ultra-fast inference',
    docsUrl: 'https://console.groq.com/docs',
  },
  mistral: {
    id: 'mistral',
    name: 'Mistral AI',
    baseUrl: 'https://api.mistral.ai/v1',
    authType: 'bearer',
    authPrefix: 'Bearer ',
    isOpenAICompatible: true,
    defaultModels: ['mistral-large-latest', 'mistral-small-latest', 'open-mistral-nemo', 'codestral-latest'],
    color: '#FF7000',
    description: 'European AI models',
    docsUrl: 'https://docs.mistral.ai',
  },
  together: {
    id: 'together',
    name: 'Together AI',
    baseUrl: 'https://api.together.xyz/v1',
    authType: 'bearer',
    authPrefix: 'Bearer ',
    isOpenAICompatible: true,
    defaultModels: ['meta-llama/Meta-Llama-3.1-70B-Instruct-Turbo', 'meta-llama/Meta-Llama-3.1-405B-Instruct-Turbo', 'Qwen/Qwen2.5-72B-Instruct-Turbo'],
    color: '#000000',
    description: 'Open-source models hosting',
    docsUrl: 'https://docs.together.ai',
  },
  openrouter: {
    id: 'openrouter',
    name: 'OpenRouter',
    baseUrl: 'https://openrouter.ai/api/v1',
    authType: 'bearer',
    authPrefix: 'Bearer ',
    isOpenAICompatible: true,
    defaultModels: ['anthropic/claude-3.5-sonnet', 'openai/gpt-4o', 'google/gemini-pro-1.5', 'meta-llama/llama-3.1-405b-instruct'],
    color: '#6467F2',
    description: 'Unified API for many models',
    docsUrl: 'https://openrouter.ai/docs',
  },
  deepseek: {
    id: 'deepseek',
    name: 'DeepSeek',
    baseUrl: 'https://api.deepseek.com/v1',
    authType: 'bearer',
    authPrefix: 'Bearer ',
    isOpenAICompatible: true,
    defaultModels: ['deepseek-chat', 'deepseek-coder', 'deepseek-reasoner'],
    color: '#4D6BFE',
    description: 'Cost-effective reasoning models',
    docsUrl: 'https://api-docs.deepseek.com',
  },
  xai: {
    id: 'xai',
    name: 'xAI (Grok)',
    baseUrl: 'https://api.x.ai/v1',
    authType: 'bearer',
    authPrefix: 'Bearer ',
    isOpenAICompatible: true,
    defaultModels: ['grok-beta', 'grok-2-latest', 'grok-2-vision-latest'],
    color: '#000000',
    description: 'Grok models',
    docsUrl: 'https://docs.x.ai',
  },
  cohere: {
    id: 'cohere',
    name: 'Cohere',
    baseUrl: 'https://api.cohere.ai/v1',
    authType: 'bearer',
    authPrefix: 'Bearer ',
    isOpenAICompatible: false,
    defaultModels: ['command-r-plus', 'command-r', 'command', 'embed-english-v3.0'],
    color: '#39594E',
    description: 'Enterprise language models',
    docsUrl: 'https://docs.cohere.com',
  },
  perplexity: {
    id: 'perplexity',
    name: 'Perplexity',
    baseUrl: 'https://api.perplexity.ai',
    authType: 'bearer',
    authPrefix: 'Bearer ',
    isOpenAICompatible: true,
    defaultModels: ['llama-3.1-sonar-large-128k-online', 'llama-3.1-sonar-small-128k-online', 'llama-3.1-sonar-huge-128k-online'],
    color: '#1FB8CD',
    description: 'Search-augmented models',
    docsUrl: 'https://docs.perplexity.ai',
  },
  custom: {
    id: 'custom',
    name: 'Custom Provider',
    baseUrl: '',
    authType: 'bearer',
    authPrefix: 'Bearer ',
    isOpenAICompatible: true,
    defaultModels: [],
    color: '#6B7280',
    description: 'Any OpenAI-compatible API',
    docsUrl: '',
  },
};

export function getProvider(id: string): ProviderConfig | undefined {
  return PROVIDERS[id] || (id.startsWith('custom-') ? { ...PROVIDERS.custom, id, name: `Custom: ${id.replace('custom-', '')}` } : undefined);
}

export function getAllProviders(): ProviderConfig[] {
  return Object.values(PROVIDERS);
}

export function isOpenAICompatibleProvider(providerId: string): boolean {
  const p = getProvider(providerId);
  return p?.isOpenAICompatible ?? false;
}

export function getProviderFromModel(model: string): string {
  // Try to infer provider from model name
  const lower = model.toLowerCase();
  
  if (lower.includes('claude')) return 'anthropic';
  if (lower.includes('gemini') || lower.includes('gemma') && lower.includes('google')) return 'google';
  if (lower.includes('grok')) return 'xai';
  if (lower.includes('mistral') || lower.includes('codestral') || lower.includes('mixtral')) {
    // mixtral could be groq or mistral, default to groq if llama present
    if (lower.includes('llama') || lower.includes('mixtral')) return 'groq';
    return 'mistral';
  }
  if (lower.includes('llama') && (lower.includes('groq') || lower.includes('70b') || lower.includes('8b'))) return 'groq';
  if (lower.includes('deepseek')) return 'deepseek';
  if (lower.includes('command') || lower.includes('cohere')) return 'cohere';
  if (lower.includes('sonar') || lower.includes('perplexity')) return 'perplexity';
  if (lower.includes('/') && (lower.includes('together') || lower.includes('meta-') || lower.includes('qwen'))) return 'together';
  
  // Default to openai for gpt, o1, etc.
  return 'openai';
}
