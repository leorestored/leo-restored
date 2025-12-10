# Railway Deployment Guide

## Step 1: Push Your Code to GitHub

1. If you haven't already, create a GitHub repository
2. Push your code:
   ```bash
   git init
   git add .
   git commit -m "Initial commit"
   git branch -M main
   git remote add origin https://github.com/YOUR_USERNAME/YOUR_REPO.git
   git push -u origin main
   ```

## Step 2: Sign Up for Railway

1. Go to https://railway.app
2. Click "Start a New Project"
3. Sign up with GitHub (recommended - easiest way)

## Step 3: Deploy Your App

1. In Railway dashboard, click "New Project"
2. Select "Deploy from GitHub repo"
3. Choose your repository
4. Railway will auto-detect it's a Node.js app

## Step 4: Configure Environment Variables

1. In your Railway project, go to "Variables" tab
2. Add these environment variables:
   - `ANTHROPIC_API_KEY` = your Anthropic API key (from your .env file)
   - `PORT` = Railway will set this automatically, but you can leave it

## Step 5: Set Up Custom Domain (Namecheap)

### In Railway:
1. Go to your project → "Settings" → "Domains"
2. Click "Custom Domain"
3. Enter your domain (e.g., `yourdomain.com`)
4. Railway will give you a CNAME value (e.g., `your-app.railway.app`)

### In Namecheap:
1. Log into Namecheap
2. Go to "Domain List" → Click "Manage" on your domain
3. Go to "Advanced DNS" tab
4. Add a new record:
   - **Type**: CNAME Record
   - **Host**: `www`
   - **Value**: The CNAME Railway gave you (e.g., `your-app.railway.app`)
   - **TTL**: Automatic (or 300)
5. For root domain (@), add:
   - **Type**: CNAME Record (or A Record if Railway provides IP)
   - **Host**: `@`
   - **Value**: Same CNAME from Railway
   - **TTL**: Automatic

## Step 6: Wait for DNS Propagation

- DNS changes can take 5 minutes to 48 hours
- Usually works within 15-30 minutes
- Railway will show "Valid" when it's ready

## Step 7: Verify It Works

1. Visit your custom domain
2. Test the chat functionality
3. Check Railway logs for any errors

## Cost Optimization Tips

- Railway free tier gives $5 credit/month
- For cheapest option, use minimal resources:
  - In Railway → Settings → Service → Resources
  - Start with smallest instance (256MB RAM, 0.5 vCPU)
  - Scale up only if needed

## Troubleshooting

- Check Railway logs if something doesn't work
- Make sure ANTHROPIC_API_KEY is set correctly
- Verify DNS settings in Namecheap
- Check that PORT is being used (Railway sets it automatically)

