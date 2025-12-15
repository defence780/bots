# Deploying mexc_bot Function

## Prerequisites
1. Supabase CLI installed
2. Logged into Supabase CLI
3. Project linked to your Supabase project

## Deployment Steps

### 1. Login to Supabase (if not already logged in)
```bash
supabase login
```

### 2. Link your project (if not already linked)
```bash
cd /Users/maxsymonenko/supabase-bot
supabase link --project-ref <your-project-ref>
```

### 3. Deploy the function
```bash
supabase functions deploy mexc_bot
```

### 4. Set environment variables
```bash
supabase secrets set BOT_TOKEN=your_telegram_bot_token
supabase secrets set URL=https://your-project.supabase.co
supabase secrets set KEY=your_supabase_anon_key
```

### 5. Get your function URL
After deployment, your function will be available at:
```
https://<your-project-ref>.supabase.co/functions/v1/mexc_bot
```

### 6. Set Telegram webhook
Update your Telegram bot's webhook URL to point to the deployed function:
```bash
curl -X POST https://api.telegram.org/bot<BOT_TOKEN>/setWebhook \
  -d "url=https://<your-project-ref>.supabase.co/functions/v1/mexc_bot"
```

## Verify Deployment

Check that your function is deployed:
```bash
supabase functions list
```

## Troubleshooting

- If deployment fails, check that you're in the correct directory
- Ensure all environment variables are set
- Check function logs: `supabase functions logs mexc_bot`

