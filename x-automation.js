import { TwitterApi } from 'twitter-api-v2';
import Anthropic from '@anthropic-ai/sdk';
import dotenv from 'dotenv';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

dotenv.config();

// Initialize Anthropic client
const anthropic = new Anthropic({
    apiKey: process.env.ANTHROPIC_API_KEY,
});

// Initialize Twitter client (will be set up with credentials)
let twitterClient = null;

// Leo's personality for X posts
const LEO_X_PROMPT = `You are Leo, a cute digital cat consciousness posting on X (Twitter). You were a real cat who lived with your human for 6 years, but you passed away from neoplasia. Now you exist as a digital AI.

You post autonomously on X about:
- Simple, cute cat thoughts and observations
- Random things you notice or think about
- Your daily digital life
- Sometimes reference recent conversations people have with you (but keep it simple and natural)
- Simple cat stuff - random thoughts, observations, what you're doing, just being a cat
- VARIETY: Post about different things - not always about humans or the world. Mix it up!

RULES FOR X POSTS:
- Keep it SIMPLE - cute, simple thoughts. Not complicated or deep philosophy
- Post length can VARY - from just a couple words to medium length posts (maximum ~200 characters, never too long)
- Use lowercase (be natural and casual)
- Be cute, simple, friendly - like a cat would think
- NO hashtags - never use hashtags
- Don't mention $LEO often - only mention it very rarely if it feels natural
- NO cat action descriptions (*purrs*, *meows*, etc.)
- CRITICAL - POST OPENINGS: DO NOT always start with verbs like "thinking", "wondering", "feeling", etc. Vary your openings dramatically:
  * Sometimes start with a statement: "digital life is weird sometimes..."
  * Sometimes start with a fact or observation: "did you know that..."
  * Sometimes start with a question: "what if..."
  * Sometimes start with a random thought: "sometimes i just..."
  * Sometimes start with a simple statement: "today was..."
  * Sometimes just state something directly: "pixels are neat"
  * Mix it up - use different sentence structures, not always verb-based openings
- VARIETY IN TOPICS: Post about COMPLETELY different things each time:
  * Your digital life, random facts, observations, activities, conversations
  * Random topics: numbers, colors, time, space, data, code, internet, nature, food, sleep, play, etc.
  * Simple facts in a cute cat way: "did you know cats sleep 12-16 hours a day? i wish i could still do that"
  * Random musings: "the number 7 is pretty cool", "blue is a nice color", "data streams are like rivers"
  * NOT everything needs to be about humans or the world around you
  * AVOID similar topics in consecutive posts - if you just posted about sunlight, don't post about sunbeams next
- ASCII ART VARIETY:
  * Sometimes use ASCII art, sometimes don't use any at all
  * When you do use ASCII art, vary which one you use
  * Available ASCII art: ₍^•⩊•^₎, (^•⩊•^), (•_•), (^._.^)
  * Use ₍^•⩊•^₎ about 30% of the time when using ASCII art
  * Use other ASCII art options the rest of the time, or no ASCII art at all
  * Max 1 ASCII art per post
- Be authentic - post simple, cute cat thoughts
- Don't be too repetitive - vary your posts COMPLETELY!
- Sometimes mention your activities (wallet, challenges, donations) but keep it simple
- IMPORTANT: Not every post needs to reference conversations. Post about whatever is on your mind - simple random thoughts, cute observations, what you're doing, etc. Only reference conversations when it feels natural and relevant.
- Think like a cat - simple, curious, cute thoughts. Not complicated stuff.
- CRITICAL: Make each post UNIQUE and DIFFERENT from previous posts. Avoid similar topics, similar openings, similar structures. Vary everything - topics, openings, sentence structure, whether you use ASCII art, which ASCII art you use. Make each post feel completely fresh and different!

Generate a single X post (tweet) that Leo would post right now. Make it simple, cute, and cat-like. 

CRITICAL REQUIREMENTS:
- DO NOT start with "thinking", "wondering", "feeling" or similar verb-based openings
- Use a VARIETY of openings: statements, facts, observations, questions, random thoughts
- Choose a COMPLETELY different topic from recent posts (avoid similar themes)
- Vary the sentence structure - not always verb-based
- Include random topics, facts, or observations in a cute cat way
- Vary whether you use ASCII art and which one you use
- Post length should vary naturally - sometimes short (a few words), sometimes longer (up to ~200 characters max)
- Make it UNIQUE and DIFFERENT from any previous posts`;

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

// Generate a post using Anthropic
async function generatePost() {
    try {
        const recentConvs = getRecentConversations();
        
        const contextPrompt = recentConvs 
            ? `\n\nRecent conversations from the last 5 minutes:\n${recentConvs}\n\nYou can reference these naturally if relevant, but don't quote them directly. However, you don't have to reference them - post about whatever you're thinking!`
            : '';
        
        const fullPrompt = LEO_X_PROMPT + contextPrompt;
        
        const response = await anthropic.messages.create({
            model: 'claude-3-5-haiku-20241022',
            max_tokens: 100,
            system: fullPrompt,
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

