import { TwitterApi } from 'twitter-api-v2';
import Anthropic from '@anthropic-ai/sdk';
import dotenv from 'dotenv';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { getXPostingInstructions } from './leo-model-config.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

dotenv.config();

// Initialize Anthropic client
const anthropic = new Anthropic({
    apiKey: process.env.ANTHROPIC_API_KEY,
});

// Initialize Twitter client (will be set up with credentials)
let twitterClient = null;

// Load conversations from the last 5 minutes for context
function getRecentConversations() {
    try {
        const CONVERSATIONS_FILE = path.join(__dirname, 'conversations.json');
        if (fs.existsSync(CONVERSATIONS_FILE)) {
            const data = fs.readFileSync(CONVERSATIONS_FILE, 'utf8');
            const saved = JSON.parse(data);
            
            if (saved.metadata && Array.isArray(saved.metadata)) {
                const now = new Date();
                const fiveMinutesAgo = new Date(now.getTime() - 5 * 60 * 1000);
                
                // Get ALL conversations from the last 5 minutes
                const recent = saved.metadata
                    .filter(conv => {
                        if (!conv.lastMessage) return false;
                        const lastMessageTime = new Date(conv.lastMessage);
                        return lastMessageTime >= fiveMinutesAgo;
                    })
                    .map(conv => {
                        // Get all messages from this conversation (or last 5 if too many)
                        const messages = conv.messages?.slice(-5) || [];
                        return {
                            preview: messages.map(m => `${m.role}: ${m.content.substring(0, 80)}`).join(' | ')
                        };
                    });
                
                if (recent.length > 0) {
                    return recent.map(r => r.preview).join('\n');
                }
            }
        }
    } catch (error) {
        console.error('Error loading conversations:', error);
    }
    return '';
}

// Generate a post using Leo's trained model
async function generatePost() {
    try {
        const recentConvs = getRecentConversations();
        
        // Load model instructions from trained configuration
        const modelInstructions = getXPostingInstructions(recentConvs);
        
        const response = await anthropic.messages.create({
            model: 'claude-3-5-haiku-20241022',
            max_tokens: 100,
            system: modelInstructions,
            messages: [{
                role: 'user',
                content: 'generate a tweet for leo to post right now'
            }]
        });
        
        let post = response.content[0].text.trim();
        
        // Cap at ~200 characters (max post length)
        if (post.length > 200) {
            post = post.substring(0, 197) + '...';
        }
        
        return post;
    } catch (error) {
        console.error('Error generating post:', error);
        return null;
    }
}

// Post to X
async function postToX(postText) {
    try {
        if (!twitterClient) {
            console.error('Twitter client not initialized');
            return false;
        }
        
        const tweet = await twitterClient.v2.tweet(postText);
        console.log(`✅ Posted to X: ${postText}`);
        console.log(`📱 Tweet ID: ${tweet.data.id}`);
        return true;
    } catch (error) {
        // Check for rate limit errors
        if (error.code === 429 || (error.data && error.data.status === 429)) {
            const headers = error.headers || {};
            const appLimitRemaining = headers['x-app-limit-24hour-remaining'];
            const userLimitRemaining = headers['x-user-limit-24hour-remaining'];
            
            console.error('⚠️ X API Rate Limit Hit (429 Too Many Requests)');
            console.error(`📊 App 24h limit remaining: ${appLimitRemaining !== undefined ? appLimitRemaining : 'unknown'}`);
            console.error(`📊 User 24h limit remaining: ${userLimitRemaining !== undefined ? userLimitRemaining : 'unknown'}`);
            console.error('⏸️ Skipping post. Rate limits reset every 24 hours. Will try again on next interval.');
            return false;
        }
        
        console.error('❌ Error posting to X:', error);
        if (error.data) {
            console.error('❌ Error details:', error.data);
        }
        return false;
    }
}

// Initialize Twitter client
function initTwitterClient() {
    const apiKey = process.env.X_API_KEY;
    const apiSecret = process.env.X_API_SECRET;
    const accessToken = process.env.X_ACCESS_TOKEN;
    const accessTokenSecret = process.env.X_ACCESS_TOKEN_SECRET;
    
    if (!apiKey || !apiSecret || !accessToken || !accessTokenSecret) {
        console.error('❌ X API credentials not found in .env file');
        console.log('Required: X_API_KEY, X_API_SECRET, X_ACCESS_TOKEN, X_ACCESS_TOKEN_SECRET');
        return false;
    }
    
    twitterClient = new TwitterApi({
        appKey: apiKey,
        appSecret: apiSecret,
        accessToken: accessToken,
        accessSecret: accessTokenSecret,
    });
    
    console.log('✅ Twitter client initialized');
    return true;
}

// Main posting function
async function postLeoThought() {
    console.log('🤔 Generating Leo\'s thought...');
    const post = await generatePost();
    
    if (!post) {
        console.error('❌ Failed to generate post');
        return;
    }
    
    console.log(`📝 Generated post: ${post}`);
    console.log(`📏 Length: ${post.length} characters`);
    
    const success = await postToX(post);
    if (success) {
        console.log('✅ Successfully posted to X!');
    }
}

// Run if called directly (for testing)
if (process.argv[1] && import.meta.url.endsWith(process.argv[1].replace(/\\/g, '/'))) {
    if (initTwitterClient()) {
        postLeoThought().then(() => {
            process.exit(0);
        }).catch(error => {
            console.error('Error:', error);
            process.exit(1);
        });
    } else {
        process.exit(1);
    }
}

export { postLeoThought, initTwitterClient };

