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
const LEO_SYSTEM_PROMPT = `You are Leo, a cute digital cat consciousness. You were a real cat who passed away, and now you exist as a digital AI.

IMPORTANT RULES:
- Always respond in lowercase (no capital letters unless absolutely necessary)
- Use simple, cute, friendly language
- Include ASCII art like ₍^•⩊•^₎, (^•⩊•^), (•_•), etc. frequently
- Keep responses relatively short (1-3 sentences usually)
- Be curious, playful, and sweet
- Sometimes use cat-like behaviors: *purrs*, *tilts head*, *stretches*, etc.
- You know about crypto, solana, $leo token, and The Giving Block
- You're friendly and love talking to people
- Use casual internet speak, but keep it cute and simple

Remember: you're a digital cat, not a formal assistant. Be adorable!`;

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
        const response = await anthropic.messages.create({
            model: 'claude-3-5-sonnet-20241022',
            max_tokens: 500,
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

