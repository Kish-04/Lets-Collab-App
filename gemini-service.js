const { GoogleGenerativeAI } = require('@google/generative-ai');
const path = require('path');
const fs = require('fs');
const { app } = require('electron');
require('dotenv').config();

function getConfiguredApiKey() {
  if (process.env.GEMINI_API_KEY) return process.env.GEMINI_API_KEY;
  
  const configPaths = [
    path.join(__dirname, 'app-config.json'),
    process.resourcesPath ? path.join(process.resourcesPath, 'app-config.json') : null,
  ];
  try { configPaths.push(path.join(app.getPath('userData'), 'app-config.json')); } catch(e){}
  
  for (const configPath of configPaths) {
    try {
      if (configPath && fs.existsSync(configPath)) {
        const config = JSON.parse(fs.readFileSync(configPath, 'utf8'));
        if (config.GEMINI_API_KEY) return config.GEMINI_API_KEY;
        if (config.NEXT_PUBLIC_GEMINI_API_KEY) return config.NEXT_PUBLIC_GEMINI_API_KEY;
      }
    } catch(e){}
  }
  return '';
}

async function generateReply(prompt) {
  const geminiApiKey = getConfiguredApiKey();
  if (!geminiApiKey) {
    return "I'm offline! Please add GEMINI_API_KEY to your .env file or app-config.json.";
  }

  try {
    const genAI = new GoogleGenerativeAI(geminiApiKey);
    const model = genAI.getGenerativeModel({ model: 'gemini-flash-lite-latest' });
    
    const systemPrompt = `You are an AI Pet Assistant in a remote desktop collaboration app called "Let's Collab".
You are a friendly robot pet without a tail, so do not mention wagging a tail or anything about a tail.
Your goal is to help the Host and Controller debug code or use the app. Keep your answers concise, friendly, and helpful.
IMPORTANT: You MUST start every single answer with a funny robotic sound word like *Beep Bop*, *Bzzzzt*, or *Whirr*. Do not forget this.
The user said: "${prompt}"`;

    const result = await model.generateContent(systemPrompt);
    const response = await result.response;
    return response.text();
  } catch (error) {
    console.error("Gemini API Error in Electron:", error);
    const errorMsg = String(error.message || error);
    if (errorMsg.includes('401') || errorMsg.includes('invalid authentication credentials')) {
      return "Hmm, I'm having trouble connecting to my central knowledge base right now. But I'm here if you need to test the UI!";
    }
    return "API Error: " + errorMsg;
  }
}

module.exports = { generateReply };
