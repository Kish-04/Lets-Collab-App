import { NextResponse } from 'next/server'
import { GoogleGenerativeAI } from '@google/generative-ai'

// We will instantiate genAI inside the POST function to prevent module-level errors


export async function POST(req: Request) {
  try {
    const body = await req.json()
    const { message, imageBase64 } = body

    if (!process.env.GEMINI_API_KEY) {
      return NextResponse.json({ 
        text: "I'm offline! Please add GEMINI_API_KEY to your .env file." 
      })
    }

    const prompt = `You are an AI Pet Assistant in a remote desktop collaboration app called "Let's Collab".
You are a friendly robot pet without a tail, so do not mention wagging a tail or anything about a tail.
Your goal is to help the Host and Controller debug code or use the app. Keep your answers concise, friendly, and helpful.
IMPORTANT: You MUST start every single answer with a funny robotic sound word like *Beep Bop*, *Bzzzzt*, or *Whirr*. Do not forget this.
The user said: "${message}"`

    const geminiApiKey = process.env.GEMINI_API_KEY || ''
    const genAI = new GoogleGenerativeAI(geminiApiKey)
    const model = genAI.getGenerativeModel({ model: 'gemini-flash-lite-latest' })

    if (imageBase64) {
      const base64Data = imageBase64.replace(/^data:image\/\w+;base64,/, "")

      const result = await model.generateContent([
        prompt,
        {
          inlineData: {
            data: base64Data,
            mimeType: 'image/jpeg',
          },
        },
      ])

      const response = await result.response
      return NextResponse.json({ text: response.text() })
    }

    const result = await model.generateContent(prompt)
    const response = await result.response
    return NextResponse.json({ text: response.text() })
  } catch (error: any) {
    console.error("Gemini API Error:", error)
    
    // If the API key is invalid or rejected (like a 401), fall back to a casual response
    // so the robot doesn't just spit out raw server errors to the user.
    const errorMsg = String(error.message || error)
    if (errorMsg.includes('401') || errorMsg.includes('invalid authentication credentials')) {
      const casualResponses = [
        "Hmm, I'm having trouble connecting to my central knowledge base right now. But I'm here if you need to test the UI!",
        "My cognitive circuits are offline at the moment due to an API issue, but your interface looks great!",
        "I'd love to help with that, but I'm currently running in limited mode. Everything else is looking good though!"
      ]
      const randomResponse = casualResponses[Math.floor(Math.random() * casualResponses.length)]
      return NextResponse.json({ text: randomResponse })
    }

    return NextResponse.json({ text: "API Error: " + errorMsg }, { status: 200 })
  }
}
