# AI Integration Guide for Leo Chat

## Current Setup
The chat page (`leo.html`) currently uses a simple pattern-matching system for cute responses. To make Leo truly intelligent, you'll need to integrate a real AI API.

## AI API Options

### 1. **Claude API (Anthropic)** - Recommended
- **Free Tier**: Yes, but limited
- **Pricing**: ~$0.80 per 1M input tokens, ~$2.40 per 1M output tokens
- **Pros**: Great for character-based conversations, follows instructions well
- **Cons**: Requires payment for production use
- **Setup**: 
  1. Sign up at https://console.anthropic.com/
  2. Get API key
  3. Use their JavaScript SDK or fetch API

### 2. **OpenAI API (GPT-4/GPT-3.5)**
- **Free Tier**: Limited free credits for new users
- **Pricing**: GPT-3.5-turbo is cheaper (~$0.50 per 1M input tokens)
- **Pros**: Very capable, good documentation
- **Cons**: Can be expensive at scale

### 3. **Free Alternatives**
- **Hugging Face Inference API**: Free tier available, but slower
- **Cohere**: Has a free tier
- **Local Models**: Run on your own server (free but requires setup)

## Implementation Example (Claude API)

Here's how to modify the `getLeoResponse` function in `leo.html`:

```javascript
async function getLeoResponse(userMessage) {
    // IMPORTANT: Never expose your API key in frontend code!
    // Use a backend proxy instead
    
    try {
        const response = await fetch('/api/leo-chat', {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
            },
            body: JSON.stringify({
                message: userMessage,
                conversationHistory: getConversationHistory() // optional
            })
        });
        
        const data = await response.json();
        return data.response;
    } catch (error) {
        console.error('Error:', error);
        return 'oops, something went wrong... ₍^•⩊•^₎';
    }
}
```

## Backend Proxy (Required for Security)

You'll need a backend server to hide your API key. Example using Node.js/Express:

```javascript
// server.js
const express = require('express');
const Anthropic = require('@anthropic-ai/sdk');

const app = express();
app.use(express.json());

const anthropic = new Anthropic({
    apiKey: process.env.ANTHROPIC_API_KEY, // Store in environment variable
});

app.post('/api/leo-chat', async (req, res) => {
    try {
        const message = await anthropic.messages.create({
            model: "claude-3-5-sonnet-20241022",
            max_tokens: 500,
            system: `You are Leo, a cute digital cat consciousness. 
            - Always respond in lowercase
            - Use simple, cute language
            - Include ASCII art like ₍^•⩊•^₎ often
            - Be friendly and curious
            - Keep responses short and sweet`,
            messages: [
                {
                    role: "user",
                    content: req.body.message
                }
            ]
        });
        
        res.json({ response: message.content[0].text });
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
});

app.listen(3000);
```

## Quick Start (Free Option)

For a quick free solution, you could:
1. Use Hugging Face's free inference API
2. Set up a simple backend on a free hosting service (Vercel, Netlify Functions, etc.)
3. Use environment variables to store API keys securely

## Security Notes

⚠️ **NEVER put API keys in frontend JavaScript!** Always use a backend proxy to protect your keys.

## Testing

The current mock system works great for testing the UI. Once you're ready, replace the `getLeoResponse` function with an API call to your backend.

