import express from 'express';
import cors from 'cors';
import dotenv from 'dotenv';
import Anthropic from '@anthropic-ai/sdk';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { postLeoThought, initTwitterClient } from './x-automation.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

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
// Store conversation metadata for logs
const conversationMetadata = [];

// File path for persistent storage
const CONVERSATIONS_FILE = path.join(__dirname, 'conversations.json');

// Load conversations from file on server start
function loadConversations() {
    try {
        console.log(`📂 Looking for conversations file at: ${CONVERSATIONS_FILE}`);
        
        if (fs.existsSync(CONVERSATIONS_FILE)) {
            const stats = fs.statSync(CONVERSATIONS_FILE);
            console.log(`📂 File exists, size: ${stats.size} bytes, modified: ${stats.mtime}`);
            
            const data = fs.readFileSync(CONVERSATIONS_FILE, 'utf8');
            const saved = JSON.parse(data);
            
            console.log(`📂 File contains: ${saved.metadata?.length || 0} metadata entries, ${saved.conversations?.length || 0} conversation sessions`);
            
            // Restore conversation metadata
            if (saved.metadata && Array.isArray(saved.metadata)) {
                conversationMetadata.push(...saved.metadata);
                console.log(`📂 Loaded ${conversationMetadata.length} conversations from disk`);
                
                // Log first few conversation IDs for debugging
                if (conversationMetadata.length > 0) {
                    const recentIds = conversationMetadata.slice(-3).map(m => m.id).join(', ');
                    console.log(`📂 Recent conversation IDs: ${recentIds}`);
                }
            } else {
                console.log('⚠️ No metadata array found in file');
            }
            
            // Restore conversation history
            if (saved.conversations && Array.isArray(saved.conversations)) {
                saved.conversations.forEach(conv => {
                    conversations.set(conv.sessionId, conv.messages || []);
                });
                console.log(`📂 Restored ${conversations.size} conversation sessions`);
            } else {
                console.log('⚠️ No conversations array found in file');
            }
            
            if (saved.lastSaved) {
                console.log(`📂 File last saved: ${saved.lastSaved}`);
            }
        } else {
            console.log('📂 No existing conversations file found, starting fresh');
            console.log(`📂 Expected file path: ${CONVERSATIONS_FILE}`);
            // Initialize empty file to ensure it exists for future saves
            try {
                const emptyData = {
                    metadata: [],
                    conversations: [],
                    lastSaved: new Date().toISOString()
                };
                const dir = path.dirname(CONVERSATIONS_FILE);
                if (!fs.existsSync(dir)) {
                    fs.mkdirSync(dir, { recursive: true });
                }
                fs.writeFileSync(CONVERSATIONS_FILE, JSON.stringify(emptyData, null, 2), 'utf8');
                console.log('📂 Initialized empty conversations.json file');
            } catch (error) {
                console.error('❌ Failed to initialize conversations file:', error);
            }
        }
    } catch (error) {
        console.error('❌ Error loading conversations:', error);
        console.error('❌ Error details:', error.message);
        if (error.stack) {
            console.error('❌ Stack trace:', error.stack);
        }
    }
}

// Save function - save immediately to prevent data loss on spin-down
let saveTimeout = null;
function saveConversations(immediate = false) {
    // Clear existing timeout
    if (saveTimeout) {
        clearTimeout(saveTimeout);
    }
    
    const saveNow = () => {
        try {
            const data = {
                metadata: conversationMetadata,
                conversations: Array.from(conversations.entries()).map(([sessionId, messages]) => ({
                    sessionId,
                    messages
                })),
                lastSaved: new Date().toISOString()
            };
            
            // Ensure directory exists
            const dir = path.dirname(CONVERSATIONS_FILE);
            if (!fs.existsSync(dir)) {
                fs.mkdirSync(dir, { recursive: true });
            }
            
            // Write file with error handling
            const jsonData = JSON.stringify(data, null, 2);
            fs.writeFileSync(CONVERSATIONS_FILE, jsonData, 'utf8');
            
            // Verify file was written
            if (fs.existsSync(CONVERSATIONS_FILE)) {
                const stats = fs.statSync(CONVERSATIONS_FILE);
                console.log(`💾 Saved ${conversationMetadata.length} conversations to disk (${stats.size} bytes, ${data.metadata.length} metadata entries)`);
            } else {
                console.error('❌ File was not created after write operation!');
            }
        } catch (error) {
            console.error('❌ Error saving conversations:', error);
            console.error('❌ File path:', CONVERSATIONS_FILE);
            console.error('❌ Error details:', error.message, error.stack);
        }
    };
    
    if (immediate) {
        saveNow();
    } else {
        // Debounce: save after 1 second of no new messages (reduced from 2 seconds)
        saveTimeout = setTimeout(saveNow, 1000);
    }
}

// Clear function to reset all conversations (for testing)
function clearAllConversations() {
    conversations.clear();
    conversationMetadata.length = 0;
    // Also delete the file
    if (fs.existsSync(CONVERSATIONS_FILE)) {
        fs.unlinkSync(CONVERSATIONS_FILE);
    }
    console.log('✅ All conversations cleared');
}

// Load conversations on server start
loadConversations();

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
            // Save new conversation to disk
            saveConversations(true); // Immediate save for new conversation
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
        console.log(`💬 User message saved: "${message.substring(0, 50)}..." (conversation ${metadata.id}, ${metadata.messageCount} messages)`);
        
        // Save to disk after user message (immediate save to prevent data loss)
        saveConversations(true);

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
        console.log(`🐱 Leo response saved: "${leoResponse.substring(0, 50)}..." (conversation ${metadata.id}, ${metadata.messageCount} messages)`);
        
        // Save to disk after each message (immediate save to ensure persistence)
        saveConversations(true);

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
        
        const totalMessages = conversationsList.reduce((sum, c) => sum + c.messageCount, 0);
        console.log(`📊 Returning ${conversationsList.length} conversations (${totalMessages} total messages)`);
        if (conversationsList.length > 0) {
            console.log(`📊 Most recent: ${conversationsList[0].id} with ${conversationsList[0].messageCount} messages`);
        }
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

// Clean URL routes - MUST be before static file serving
app.get('/', (req, res) => {
    res.sendFile(path.join(__dirname, 'index.html'));
});

app.get('/enter', (req, res) => {
    res.sendFile(path.join(__dirname, 'o', 'first.html'));
});

app.get('/menu', (req, res) => {
    res.sendFile(path.join(__dirname, 'o', 'second.html'));
});

app.get('/chat', (req, res) => {
    res.sendFile(path.join(__dirname, 'o', 'leo.html'));
});

app.get('/about', (req, res) => {
    res.sendFile(path.join(__dirname, 'o', 'about.html'));
});

app.get('/logs', (req, res) => {
    res.sendFile(path.join(__dirname, 'o', 'logs.html'));
});

app.get('/challenges', (req, res) => {
    res.sendFile(path.join(__dirname, 'o', 'challenges.html'));
});

app.get('/donations', (req, res) => {
    res.sendFile(path.join(__dirname, 'o', 'donations.html'));
});

// Serve static files (CSS, images, etc.) - MUST be after API routes and URL routes
app.use(express.static('.'));

// Save conversations on server shutdown
process.on('SIGTERM', () => {
    console.log('🛑 SIGTERM received, saving conversations...');
    saveConversations(true); // Immediate save
    process.exit(0);
});

process.on('SIGINT', () => {
    console.log('🛑 SIGINT received, saving conversations...');
    saveConversations(true); // Immediate save
    process.exit(0);
});

// Initialize X automation (if credentials are provided)
let xPostInterval = null;
function setupXAutomation() {
    // Prevent multiple intervals from being set up
    if (xPostInterval !== null) {
        console.log('⚠️ X automation already initialized, skipping duplicate setup');
        return;
    }
    
    if (process.env.X_API_KEY && process.env.X_API_SECRET && process.env.X_ACCESS_TOKEN && process.env.X_ACCESS_TOKEN_SECRET) {
        try {
            if (initTwitterClient()) {
                // Post every ~85 minutes by default (5100000 ms) to stay within 17 posts/24h limit
                // 24 hours = 1440 minutes / 17 posts = ~85 minutes per post
                // Change X_POST_INTERVAL in .env to adjust:
                // 5100000 = ~85 minutes (17 posts/day - safe for free tier)
                // 3600000 = 1 hour (24 posts/day - exceeds limit!)
                // 7200000 = 2 hours (12 posts/day - safe)
                // 10800000 = 3 hours (8 posts/day - very safe)
                // NOTE: X API free tier limit is 17 posts per 24 hours
                // - Posting every 85 minutes = ~17 posts/day (at the limit)
                // - To be safer, use 90-100 minutes or upgrade your X API tier
                const POST_INTERVAL = process.env.X_POST_INTERVAL ? parseInt(process.env.X_POST_INTERVAL) : 5100000; // ~85 minutes default (17 posts/day)
                
                // Schedule regular posts
                xPostInterval = setInterval(() => {
                    postLeoThought();
                }, POST_INTERVAL);
                
                const intervalMinutes = Math.round(POST_INTERVAL / 60000);
                const postsPerDay = Math.round((24 * 60) / intervalMinutes);
                console.log(`📱 X automation enabled - posting every ${intervalMinutes} minutes (${postsPerDay} posts/day)`);
                console.log(`ℹ️ Note: If you hit rate limits (429 errors), posts will be skipped until limits reset (24 hours)`);
                console.log(`⚠️ WARNING: X API free tier limit is 17 posts per 24 hours. Current setting: ${postsPerDay} posts/day`);
                if (postsPerDay > 17) {
                    console.log(`⚠️ ⚠️ ⚠️ You are EXCEEDING the limit! Increase X_POST_INTERVAL to avoid rate limits!`);
                }
            }
        } catch (error) {
            console.log('ℹ️ X automation disabled:', error.message);
        }
    } else {
        console.log('ℹ️ X automation disabled - no X API credentials found');
    }
}

app.listen(PORT, '0.0.0.0', () => {
    console.log(`🐱 Leo chat server running on port ${PORT}`);
    console.log(`Make sure your ANTHROPIC_API_KEY is set in .env`);
    console.log(`💾 Conversations file: ${CONVERSATIONS_FILE}`);
    
    // Setup X automation after server starts
    setupXAutomation();
});

