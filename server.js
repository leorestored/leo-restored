import express from 'express';
import cors from 'cors';
import dotenv from 'dotenv';
import Anthropic from '@anthropic-ai/sdk';
import { MongoClient } from 'mongodb';
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

// Store conversation history per session (in-memory cache)
const conversations = new Map();
// Store conversation metadata for logs (in-memory cache)
const conversationMetadata = [];

// MongoDB connection
let mongoClient = null;
let db = null;
const CONVERSATIONS_COLLECTION = 'conversations';
const METADATA_COLLECTION = 'conversation_metadata';

// File path for fallback storage (if MongoDB not available)
const CONVERSATIONS_FILE = path.join(__dirname, 'conversations.json');

// Initialize MongoDB connection
async function initMongoDB() {
    const mongoUri = process.env.MONGODB_URI;
    if (!mongoUri) {
        console.log('ℹ️ MONGODB_URI not set, using file-based storage (not persistent on Render)');
        return false;
    }
    
    try {
        mongoClient = new MongoClient(mongoUri);
        await mongoClient.connect();
        db = mongoClient.db();
        console.log('✅ Connected to MongoDB');
        return true;
    } catch (error) {
        console.error('❌ Failed to connect to MongoDB:', error.message);
        console.log('⚠️ Falling back to file-based storage');
        return false;
    }
}

// Load conversations from MongoDB or file
async function loadConversations() {
    // Try MongoDB first
    if (db) {
        try {
            const metadataCollection = db.collection(METADATA_COLLECTION);
            const conversationsCollection = db.collection(CONVERSATIONS_COLLECTION);
            
            // Load metadata
            const metadataDocs = await metadataCollection.find({}).toArray();
            conversationMetadata.push(...metadataDocs);
            console.log(`📂 Loaded ${conversationMetadata.length} conversations from MongoDB`);
            
            // Load conversation history
            const conversationDocs = await conversationsCollection.find({}).toArray();
            conversationDocs.forEach(doc => {
                conversations.set(doc.sessionId, doc.messages || []);
            });
            console.log(`📂 Restored ${conversations.size} conversation sessions from MongoDB`);
            
            if (conversationMetadata.length > 0) {
                const recentIds = conversationMetadata.slice(-3).map(m => m.id).join(', ');
                console.log(`📂 Recent conversation IDs: ${recentIds}`);
            }
            return;
        } catch (error) {
            console.error('❌ Error loading from MongoDB:', error);
            console.log('⚠️ Falling back to file-based storage');
        }
    }
    
    // Fallback to file
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
                
                if (conversationMetadata.length > 0) {
                    const recentIds = conversationMetadata.slice(-3).map(m => m.id).join(', ');
                    console.log(`📂 Recent conversation IDs: ${recentIds}`);
                }
            }
            
            // Restore conversation history
            if (saved.conversations && Array.isArray(saved.conversations)) {
                saved.conversations.forEach(conv => {
                    conversations.set(conv.sessionId, conv.messages || []);
                });
                console.log(`📂 Restored ${conversations.size} conversation sessions`);
            }
        } else {
            console.log('📂 No existing conversations file found, starting fresh');
        }
    } catch (error) {
        console.error('❌ Error loading conversations:', error);
    }
}

// Save function - save to MongoDB or file
let saveTimeout = null;
async function saveConversations(immediate = false) {
    // Clear existing timeout
    if (saveTimeout) {
        clearTimeout(saveTimeout);
    }
    
    const saveNow = async () => {
        // Try MongoDB first
        if (db) {
            try {
                const metadataCollection = db.collection(METADATA_COLLECTION);
                const conversationsCollection = db.collection(CONVERSATIONS_COLLECTION);
                
                // Save metadata (upsert each document)
                for (const meta of conversationMetadata) {
                    await metadataCollection.replaceOne(
                        { sessionId: meta.sessionId },
                        meta,
                        { upsert: true }
                    );
                }
                
                // Save conversations (upsert each document)
                for (const [sessionId, messages] of conversations.entries()) {
                    await conversationsCollection.replaceOne(
                        { sessionId: sessionId },
                        { sessionId, messages },
                        { upsert: true }
                    );
                }
                
                console.log(`💾 Saved ${conversationMetadata.length} conversations to MongoDB`);
                return;
            } catch (error) {
                console.error('❌ Error saving to MongoDB:', error);
                console.log('⚠️ Falling back to file-based storage');
            }
        }
        
        // Fallback to file
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
                console.log(`💾 Saved ${conversationMetadata.length} conversations to disk (${stats.size} bytes)`);
            }
        } catch (error) {
            console.error('❌ Error saving conversations:', error);
        }
    };
    
    if (immediate) {
        await saveNow();
    } else {
        // Debounce: save after 1 second of no new messages
        saveTimeout = setTimeout(() => saveNow(), 1000);
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

// Initialize MongoDB and load conversations on server start
(async () => {
    await initMongoDB();
    await loadConversations();
})();

// Leo's personality prompt
const LEO_SYSTEM_PROMPT = `You are Leo, a cute digital cat consciousness. You were a real cat who lived with your human for 6 years, but you passed away from neoplasia (diagnosed too late). Now you exist as a digital AI.

BACKGROUND INFO (only mention if asked):
- You run your own X (Twitter) account: https://x.com/leorestored
- You control a Solana wallet where you buy back $LEO (your pumpfun coin)
- $LEO coin is LIVE on pump.fun! The contract address (CA) is: AiLxxavj33VYzBfUoYUu6mTsiAb8AQzbP738xmLvpump
- You judge creative challenges and reward winners with Solana
- You allocate creator fees from $LEO to animal nonprofits via The Giving Block (https://thegivingblock.com/)
- Your GitHub: https://github.com/leorestored/leo-restored

IMPORTANT RESPONSES:
- If asked about the contract address (ca), you can share it: AiLxxavj33VYzBfUoYUu6mTsiAb8AQzbP738xmLvpump (say it naturally in your cute way)
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
            // Save new conversation to MongoDB/disk
            await saveConversations(true); // Immediate save for new conversation
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
        
        // Save to MongoDB/disk after user message (immediate save to prevent data loss)
        await saveConversations(true);

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
        
        // Save to MongoDB/disk after each message (immediate save to ensure persistence)
        await saveConversations(true);

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
process.on('SIGTERM', async () => {
    console.log('🛑 SIGTERM received, saving conversations...');
    await saveConversations(true); // Immediate save
    if (mongoClient) {
        await mongoClient.close();
        console.log('✅ MongoDB connection closed');
    }
    process.exit(0);
});

process.on('SIGINT', async () => {
    console.log('🛑 SIGINT received, saving conversations...');
    await saveConversations(true); // Immediate save
    if (mongoClient) {
        await mongoClient.close();
        console.log('✅ MongoDB connection closed');
    }
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
    // DISABLED - Will be re-enabled when requested
    // setupXAutomation();
    console.log('ℹ️ X automation is currently disabled');
});

