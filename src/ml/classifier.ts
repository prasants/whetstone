/**
 * Signal Classifier — Learned signal detection.
 *
 * Replaces regex-based detection with a fine-tuned classifier
 * on top of nomic-embed-text embeddings via Ollama.
 */

import { SignalType, SignalCategory, Confidence } from '../types.js';

// Ollama embedding endpoint
const OLLAMA_BASE_URL = process.env.OLLAMA_BASE_URL || 'http://localhost:11434';
const EMBEDDING_MODEL = 'nomic-embed-text';

export interface ClassifierPrediction {
  type: SignalType;
  category: SignalCategory;
  confidence: Confidence;
  score: number;
}

export interface TrainingExample {
  text: string;
  label: SignalType;
  category: SignalCategory;
}

/**
 * Get embedding from Ollama.
 */
export async function getEmbedding(text: string): Promise<number[]> {
  const response = await fetch(`${OLLAMA_BASE_URL}/api/embeddings`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      model: EMBEDDING_MODEL,
      prompt: text,
    }),
  });

  if (!response.ok) {
    throw new Error(`Ollama embedding failed: ${response.status}`);
  }

  const data = await response.json();
  return data.embedding;
}

/**
 * Cosine similarity between two vectors.
 */
export function cosineSimilarity(a: number[], b: number[]): number {
  if (a.length !== b.length) throw new Error('Vector length mismatch');

  let dotProduct = 0;
  let normA = 0;
  let normB = 0;

  for (let i = 0; i < a.length; i++) {
    dotProduct += a[i] * b[i];
    normA += a[i] * a[i];
    normB += b[i] * b[i];
  }

  return dotProduct / (Math.sqrt(normA) * Math.sqrt(normB));
}

/**
 * Simple MLP for classification.
 * Weights are stored as JSON for portability.
 */
export class SignalClassifier {
  private centroids: Map<SignalType, number[]> = new Map();
  private categoryMap: Map<SignalType, SignalCategory> = new Map([
    ['correction', 'judgment'],
    ['failure', 'tool_use'],
    ['takeover', 'tool_use'],
    ['frustration', 'judgment'],
    ['style', 'style'],
    ['success', 'judgment'],
  ]);

  constructor() {}

  /**
   * Train the classifier from labelled examples.
   * Uses centroid-based classification for simplicity and interpretability.
   */
  async train(examples: TrainingExample[]): Promise<void> {
    const embeddings: Map<SignalType, number[][]> = new Map();

    // Group examples by label
    for (const example of examples) {
      if (!embeddings.has(example.label)) {
        embeddings.set(example.label, []);
      }
    }

    // Get embeddings for all examples
    for (const example of examples) {
      const embedding = await getEmbedding(example.text);
      embeddings.get(example.label)!.push(embedding);
    }

    // Compute centroids (mean embedding per class)
    for (const [label, vecs] of embeddings) {
      if (vecs.length === 0) continue;

      const dim = vecs[0].length;
      const centroid = new Array(dim).fill(0);

      for (const vec of vecs) {
        for (let i = 0; i < dim; i++) {
          centroid[i] += vec[i] / vecs.length;
        }
      }

      this.centroids.set(label, centroid);
    }
  }

  /**
   * Load pre-trained centroids.
   */
  loadWeights(weights: Record<string, number[]>): void {
    this.centroids.clear();
    for (const [label, centroid] of Object.entries(weights)) {
      this.centroids.set(label as SignalType, centroid);
    }
  }

  /**
   * Export trained centroids.
   */
  exportWeights(): Record<string, number[]> {
    const weights: Record<string, number[]> = {};
    for (const [label, centroid] of this.centroids) {
      weights[label] = centroid;
    }
    return weights;
  }

  /**
   * Classify a message.
   */
  async predict(text: string): Promise<ClassifierPrediction | null> {
    if (this.centroids.size === 0) {
      throw new Error('Classifier not trained');
    }

    const embedding = await getEmbedding(text);

    let bestType: SignalType | null = null;
    let bestScore = -Infinity;

    for (const [label, centroid] of this.centroids) {
      const similarity = cosineSimilarity(embedding, centroid);
      if (similarity > bestScore) {
        bestScore = similarity;
        bestType = label;
      }
    }

    if (!bestType || bestScore < 0.3) {
      return null; // No confident prediction
    }

    const confidence: Confidence =
      bestScore > 0.7 ? 'high' : bestScore > 0.5 ? 'medium' : 'low';

    return {
      type: bestType,
      category: this.categoryMap.get(bestType) || 'judgment',
      confidence,
      score: bestScore,
    };
  }

  /**
   * Batch predict for efficiency.
   */
  async predictBatch(texts: string[]): Promise<(ClassifierPrediction | null)[]> {
    return Promise.all(texts.map((t) => this.predict(t)));
  }
}

/**
 * Generate synthetic training data for cold start.
 */
export function generateSyntheticTrainingData(): TrainingExample[] {
  const examples: TrainingExample[] = [];

  // Corrections
  const corrections = [
    "No, I meant the other file",
    "Actually, use the node runner not SSH",
    "That's wrong, the amount is different",
    "Wrong tool, use curl instead",
    "I said use tables, not bullet points",
    "No, I want it formatted differently",
    "That's not what I asked for",
    "You misunderstood, I need X not Y",
    "Incorrect, the deadline is next week",
    "No no no, listen to me",
    "I already told you not to do that",
    "Wrong approach, try again",
    "That's not right at all",
    "You've got it backwards",
    "Not what I meant, let me clarify",
    "Actually the correct answer is",
    "No that's incorrect",
    "You misread my request",
    "That's the wrong interpretation",
    "I need you to fix this",
  ];

  for (const text of corrections) {
    examples.push({ text, label: 'correction', category: 'judgment' });
  }

  // Frustration
  const frustrations = [
    "What the fuck is this",
    "This is fucking useless",
    "I already told you three times",
    "WHY ARE YOU NOT LISTENING",
    "For fuck's sake",
    "You're completely useless",
    "I'm so frustrated with this",
    "This is infuriating",
    "Can you not read?",
    "How many times do I have to repeat myself",
    "Jesus Christ, just do it properly",
    "I'm losing my patience here",
    "This is absolutely unacceptable",
    "You're making me angry",
    "Stop wasting my time",
    "I've had enough of this",
    "You dumb fuck",
    "Are you even trying",
    "This is ridiculous",
    "I can't believe how bad this is",
  ];

  for (const text of frustrations) {
    examples.push({ text, label: 'frustration', category: 'judgment' });
  }

  // Takeover
  const takeovers = [
    "Let me just do it myself",
    "Never mind, I'll handle it",
    "Forget it, I'll run the command",
    "I'll take care of this",
    "Just give me the access, I'll do it",
    "Let me take over from here",
    "I'll fix this myself",
    "Don't bother, I got it",
    "Move aside, I'll do it properly",
    "I'll just write it myself",
    "Let me handle the rest",
    "I'm taking over this task",
    "Stop, I'll finish it",
    "I'll complete this on my own",
    "Just give me control",
  ];

  for (const text of takeovers) {
    examples.push({ text, label: 'takeover', category: 'tool_use' });
  }

  // Failure (these would typically come from tool errors)
  const failures = [
    "The command failed again",
    "Still getting the same error",
    "Third time it's crashed",
    "The API returned an error",
    "Connection timed out again",
    "Authentication failed",
    "Permission denied error",
    "The file wasn't found",
    "Database connection dropped",
    "Request failed with status 500",
    "The service is unavailable",
    "Got a timeout exception",
    "Memory allocation failed",
    "Process exited with error",
    "Build failed with errors",
  ];

  for (const text of failures) {
    examples.push({ text, label: 'failure', category: 'tool_use' });
  }

  // Style
  const styles = [
    "Format it like a table instead",
    "That's too verbose, cut it in half",
    "Use bullet points please",
    "Make it more concise",
    "I prefer markdown headers",
    "Can you reformat this as JSON",
    "Too long, summarise it",
    "Write it more formally",
    "Use British English spelling",
    "Add some structure to this",
    "Break it into sections",
    "Make it easier to scan",
    "Use numbered lists",
    "Format the dates consistently",
    "Align the columns properly",
  ];

  for (const text of styles) {
    examples.push({ text, label: 'style', category: 'style' });
  }

  // Success
  const successes = [
    "Perfect, exactly what I needed",
    "That's spot on, thanks",
    "Brilliant work",
    "Exactly right",
    "This is great, thank you",
    "Nailed it",
    "Perfect, ship it",
    "This looks excellent",
    "Great job on this",
    "Precisely what I was looking for",
    "Wonderful, that's perfect",
    "You got it exactly right",
    "This is exactly what I wanted",
    "Excellent work",
    "Superb, thank you",
  ];

  for (const text of successes) {
    examples.push({ text, label: 'success', category: 'judgment' });
  }

  return examples;
}
