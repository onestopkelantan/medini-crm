/* MiniMax adapter — calls MiniMax chat completion API.
 * Reads API key from env (MINIMAX_API_KEY). Never hardcode the key. */
import { Injectable } from '@nestjs/common';

@Injectable()
export class MinimaxAdapter {
  private readonly baseUrl = 'https://api.minimax.io/v1/text/chatcompletion_v2';
  private readonly model = 'MiniMax-M3';

  async chat(systemPrompt: string, userMessage: string): Promise<string> {
    const key = process.env.MINIMAX_API_KEY;
    if (!key) throw new Error('MINIMAX_API_KEY not set');

    const res = await fetch(this.baseUrl, {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${key}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        model: this.model,
        messages: [
          { role: 'system', content: systemPrompt },
          { role: 'user', content: userMessage },
        ],
      }),
    });

    if (!res.ok) {
      throw new Error(`MiniMax HTTP ${res.status}`);
    }

    const data: any = await res.json();
    const reply = data?.choices?.[0]?.message?.content;
    if (!reply) throw new Error('MiniMax: no content in response');
    return reply;
  }
}