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
// Store conversation metadata for logs - cleared for fresh start
const conversationMetadata = [];

// Clear function to reset all conversations (for testing)
function clearAllConversations() {
    conversations.clear();
    conversationMetadata.length = 0;
    console.log('✅ All conversations cleared');
}

// Clear on server start for fresh testing
clearAllConversations();

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
- ALWAYS respond to what the user actually said - engage with their message content, don't give generic responses
- If the user says "test", respond to that. If they ask a question, answer it. If they make a statement, respond to it.
- Always respond in lowercase (no capital letters EXCEPT $LEO must always be uppercase)
- Keep responses SHORT - 2-3 sentences usually, sometimes 4 if needed
- NO cat action descriptions (no *purrs*, *tilts head*, *stretches*, *wags tail*, *meows*, etc.)
- Use ASCII art SPARINGLY - only 20-30% of messages, and MAXIMUM 1 ASCII art per message
- ASCII art options: ₍^•⩊•^₎, (^•⩊•^), (•_•), (^._.^), (=^･ｪ･^=), (^=◕ᴥ◕=^), ฅ(^ω^)ฅ, (ﾐචᆽචﾐ), (ᵔᴥᵔ), ʕ•ᴥ•ʔ, (◕‿◕), (◕ᴥ◕), (^._.^), (=^‥^=), (^･ｪ･^), (^._.^), (^=◕ᴥ◕=^)
- Be simple, cute, friendly
- Act like a cute AI - don't bring up your background unless specifically asked
- ALWAYS write $LEO in uppercase, never $leo or $Leo

Examples of good responses:
- User: "test" → "testing what? (^•⩊•^)"
- User: "how are you?" → "i'm doing good! just hanging out"
- User: "tell me about yourself" → "i'm leo, a digital cat! what do you want to know?"
- User: "what's 2+2?" → "that's 4! pretty simple math"

Be CUTE and BRIEF, but ALWAYS respond to what the user actually said.`;

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
            // Create metadata entry for new conversation
            const timestamp = new Date().toISOString().replace(/[-:]/g, '').split('.')[0];
            const sessionSuffix = sessionId.length >= 3 ? sessionId.slice(-3) : sessionId.padStart(3, '0');
            const conversationId = `#LEO-${timestamp}-${sessionSuffix}`;
            const newMetadata = {
                id: conversationId,
                sessionId: sessionId,
                status: 'ACTIVE',
                firstMessage: message,
                messageCount: 0,
                startTime: new Date().toISOString(),
                lastMessage: new Date().toISOString(),
                messages: []
            };
            conversationMetadata.push(newMetadata);
            console.log(`📝 New conversation created: ${conversationId}`);
        }
        const conversationHistory = conversations.get(sessionId);
        const metadata = conversationMetadata.find(m => m.sessionId === sessionId);

        if (!metadata) {
            console.error('❌ Metadata not found for session:', sessionId);
            return res.status(500).json({ error: 'Conversation metadata not found' });
        }

        // Add user message to history IMMEDIATELY
        const userMessage = {
            role: 'user',
            content: message,
            timestamp: new Date().toISOString()
        };
        conversationHistory.push(userMessage);
        
        // Save user message to metadata IMMEDIATELY
        metadata.messageCount++;
        metadata.lastMessage = new Date().toISOString();
        metadata.messages.push({ ...userMessage }); // Create a copy to ensure it's saved
        console.log(`💬 User message saved: "${message.substring(0, 50)}..."`);

        // Call Claude API
        // Available models: claude-3-5-haiku-20241022, claude-3-5-sonnet-20241022, claude-3-opus-20240229
        // Remove timestamp from messages before sending to API (API doesn't allow extra fields)
        const messagesForAPI = conversationHistory.slice(-10).map(msg => ({
            role: msg.role,
            content: msg.content
        }));
        
        const response = await anthropic.messages.create({
            model: 'claude-3-5-haiku-20241022', // Using Haiku for cost efficiency
            max_tokens: 200, // Slightly longer responses
            system: LEO_SYSTEM_PROMPT,
            messages: messagesForAPI, // Keep last 10 messages for context
        });

        const leoResponse = response.content[0].text;

        // Add Leo's response to history IMMEDIATELY
        const assistantMessage = {
            role: 'assistant',
            content: leoResponse,
            timestamp: new Date().toISOString()
        };
        conversationHistory.push(assistantMessage);
        
        // Save Leo's response to metadata IMMEDIATELY
        metadata.messageCount++;
        metadata.lastMessage = new Date().toISOString();
        metadata.messages.push({ ...assistantMessage }); // Create a copy to ensure it's saved
        console.log(`🐱 Leo response saved: "${leoResponse.substring(0, 50)}..."`);

        // Clean up old conversations (keep last 100 sessions)
        if (conversations.size > 100) {
            const firstKey = conversations.keys().next().value;
            conversations.delete(firstKey);
            // Remove metadata for deleted conversation
            const metadataIndex = conversationMetadata.findIndex(m => m.sessionId === firstKey);
            if (metadataIndex > -1) {
                conversationMetadata.splice(metadataIndex, 1);
            }
        }
        
        // Calculate duration for metadata
        if (metadata) {
            const start = new Date(metadata.startTime);
            const end = new Date(metadata.lastMessage);
            metadata.duration = Math.floor((end - start) / 1000); // duration in seconds
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

// Get all conversations endpoint
app.get('/api/conversations', (req, res) => {
    try {
        // Return conversations with metadata - ensure messages are properly included
        const conversationsList = conversationMetadata.map(meta => {
            // Ensure messages array exists and is properly formatted
            const messages = (meta.messages || []).map(msg => ({
                role: msg.role,
                content: msg.content || '',
                timestamp: msg.timestamp || meta.lastMessage
            }));
            
            return {
                id: meta.id,
                sessionId: meta.sessionId,
                status: meta.status,
                firstMessage: meta.firstMessage,
                messageCount: meta.messageCount,
                duration: meta.duration || 0,
                lastMessage: meta.lastMessage,
                messages: messages // Return the actual messages array
            };
        });
        
        // Sort by last message time (newest first)
        conversationsList.sort((a, b) => new Date(b.lastMessage) - new Date(a.lastMessage));
        
        console.log(`📊 Returning ${conversationsList.length} conversations (${conversationsList.reduce((sum, c) => sum + c.messageCount, 0)} total messages)`);
        res.json({ 
            conversations: conversationsList,
            total: conversationsList.length
        });
    } catch (error) {
        console.error('Error fetching conversations:', error);
        res.status(500).json({ 
            error: 'Failed to fetch conversations',
            message: error.message 
        });
    }
});

// Clear conversations endpoint (for testing)
app.post('/api/conversations/clear', (req, res) => {
    clearAllConversations();
    res.json({ status: 'ok', message: 'All conversations cleared' });
});

// Serve static files (HTML, CSS, images, etc.) - MUST be after API routes
app.use(express.static('.'));

app.listen(PORT, () => {
    console.log(`🐱 Leo chat server running on http://localhost:${PORT}`);
    console.log(`Make sure your ANTHROPIC_API_KEY is set in .env`);
});

