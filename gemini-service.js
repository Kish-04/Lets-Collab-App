const { GoogleGenerativeAI } = require('@google/generative-ai');
require('dotenv').config();

async function generateReply(prompt) {
  const geminiApiKey = process.env.GEMINI_API_KEY || '';
  if (!geminiApiKey) {
    return "I'm offline! Please add GEMINI_API_KEY to your .env file.";
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
