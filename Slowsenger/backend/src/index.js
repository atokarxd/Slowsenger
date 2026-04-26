import express from 'express';
import cors from 'cors';
import dotenv from 'dotenv';

dotenv.config();

const app = express();
const port = Number(process.env.PORT ?? 4000);
const META_APP_ID = process.env.META_APP_ID;
const META_APP_SECRET = process.env.META_APP_SECRET;

app.use(cors({ origin: 'http://localhost:4200' }));
app.use(express.json());

app.get('/health', (_req, res) => {
    res.json({ ok: true, service: 'slowsenger-backend' });
});

// Exchange the OAuth code for a user access token and return basic user info.
// The App Secret stays on the server; only the user ID and name go to the client.
app.post('/meta/oauth/exchange', async (req, res) => {
    const { code, redirectUri } = req.body ?? {};

    if (!code || !redirectUri) {
        res.status(400).json({ error: 'code and redirectUri are required' });
        return;
    }

    try {
        const params = new URLSearchParams({
            client_id: META_APP_ID,
            client_secret: META_APP_SECRET,
            redirect_uri: redirectUri,
            code,
        });

        const tokenRes = await fetch(`https://graph.facebook.com/v19.0/oauth/access_token?${params}`);
        const tokenData = await tokenRes.json();

        if (tokenData.error) {
            res.status(400).json({ error: tokenData.error.message });
            return;
        }

        const userRes = await fetch(
            `https://graph.facebook.com/v19.0/me?fields=id,name&access_token=${tokenData.access_token}`
        );
        const userData = await userRes.json();

        if (userData.error) {
            res.status(400).json({ error: userData.error.message });
            return;
        }

        // Get the Pages the user manages (needed for Messenger API)
        const pagesRes = await fetch(
            `https://graph.facebook.com/v19.0/me/accounts?access_token=${tokenData.access_token}`
        );
        const pagesData = await pagesRes.json();
        const firstPage = pagesData.data?.[0] ?? null;

        res.json({
            userId: userData.id,
            name: userData.name,
            pageId: firstPage?.id ?? null,
            pageToken: firstPage?.access_token ?? null,
            pageName: firstPage?.name ?? null,
        });
    } catch (err) {
        res.status(500).json({ error: 'Token exchange failed' });
    }
});

app.get('/meta/webhook', (req, res) => {
    const verifyToken = process.env.META_WEBHOOK_VERIFY_TOKEN;
    const mode = req.query['hub.mode'];
    const token = req.query['hub.verify_token'];
    const challenge = req.query['hub.challenge'];

    if (mode === 'subscribe' && token === verifyToken) {
        res.status(200).send(String(challenge ?? ''));
        return;
    }

    res.sendStatus(403);
});

app.post('/meta/webhook', async (_req, res) => {
    res.status(200).json({ ok: true });
});

app.listen(port, () => {
    console.log(`Slowsenger backend running on http://localhost:${port}`);
});

module.exports = app;