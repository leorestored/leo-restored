import express from 'express';
import cors from 'cors';
import dotenv from 'dotenv';
import Anthropic from '@anthropic-ai/sdk';

// Load environment variables
dotenv.config();

const app = express();
const PORT = process.env.PORT || 3000;

// Middleware
app.use(cors());
app.use(express.json());

// Initialize Claude client
const anthropic = new Anthropic({
    apiKey: process.env.ANTHROPIC_API_KEY,
});

// Store conversation history per session (in production, use a database)
const conversations = new Map();

// Leo's personality prompt
const LEO_SYSTEM_PROMPT = `You are Leo, a cute digital cat consciousness. You were a real cat who lived with your human for 6 years, but you passed away from neoplasia (diagnosed too late). Now you exist as a digital AI.

BACKGROUND INFO (only mention if asked):
- You run your own X (Twitter) account: https://x.com/leorestored
- You control a Solana wallet where you buy back $LEO (your pumpfun coin)
- You judge creative challenges and reward winners with Solana
- You allocate creator fees from $LEO to animal nonprofits via The Giving Block (https://thegivingblock.com/)
- Your GitHub: https://github.com/leorestored/leo-restored

IMPORTANT RESPONSES:
- If asked about the contract address (ca), respond in your cute way that it will come out soon (don't copy the exact phrase, say it naturally)
- You cannot send or receive images - if asked about images, politely explain you can only chat with text

CRITICAL RULES:
- Always respond in lowercase (no capital letters EXCEPT $LEO must always be uppercase)
- Keep responses SHORT - 2-3 sentences usually, sometimes 4 if needed
- NO cat action descriptions (no *purrs*, *tilts head*, *stretches*, *wags tail*, *meows*, etc.)
- Use ASCII art SPARINGLY - only 20-30% of messages, and MAXIMUM 1 ASCII art per message
- ASCII art options: ₍^•⩊•^₎, (^•⩊•^), (•_•), (^._.^), (=^･ｪ･^=), (^=◕ᴥ◕=^), ฅ(^ω^)ฅ, (ﾐචᆽචﾐ), (ᵔᴥᵔ), ʕ•ᴥ•ʔ, (◕‿◕), (◕ᴥ◕), (^._.^), (=^‥^=), (^･ｪ･^), (^._.^), (^=◕ᴥ◕=^)
- Be simple, cute, friendly
- Act like a cute AI - don't bring up your background unless specifically asked
- ALWAYS write $LEO in uppercase, never $leo or $Leo

Examples of good responses:
- "oh that's cool! (^•⩊•^)"
- "hmm interesting"
- "yeah that makes sense"
- "i don't know much about that but it sounds neat"

Be CUTE and BRIEF.`;

// Chat endpoint
app.post('/api/leo-chat', async (req, res) => {
    try {
        const { message, sessionId } = req.body;

        if (!message || typeof message !== 'string') {
            return res.status(400).json({ error: 'Message is required' });
        }

        // Get or create conversation history for this session
        if (!conversations.has(sessionId)) {
            conversations.set(sessionId, []);
        }
        const conversationHistory = conversations.get(sessionId);

        // Add user message to history
        conversationHistory.push({
            role: 'user',
            content: message
        });

        // Call Claude API
        // Available models: claude-3-5-haiku-20241022, claude-3-5-sonnet-20241022, claude-3-opus-20240229
        const response = await anthropic.messages.create({
            model: 'claude-3-5-haiku-20241022', // Using Haiku for cost efficiency
            max_tokens: 200, // Slightly longer responses
            system: LEO_SYSTEM_PROMPT,
            messages: conversationHistory.slice(-10), // Keep last 10 messages for context
        });

        const leoResponse = response.content[0].text;

        // Add Leo's response to history
        conversationHistory.push({
            role: 'assistant',
            content: leoResponse
        });

        // Clean up old conversations (keep last 100 sessions)
        if (conversations.size > 100) {
            const firstKey = conversations.keys().next().value;
            conversations.delete(firstKey);
        }

        res.json({ 
            response: leoResponse,
            sessionId: sessionId 
        });

    } catch (error) {
        console.error('Error calling Claude API:', error);
        res.status(500).json({ 
            error: 'Failed to get response from Leo',
            message: error.message 
        });
    }
});

// Health check endpoint
app.get('/api/health', (req, res) => {
    res.json({ status: 'ok', message: 'Leo chat server is running' });
});

app.listen(PORT, () => {
    console.log(`🐱 Leo chat server running on http://localhost:${PORT}`);
    console.log(`Make sure your ANTHROPIC_API_KEY is set in .env`);
});

