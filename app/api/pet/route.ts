import { NextResponse } from 'next/server'
import { GoogleGenerativeAI } from '@google/generative-ai'
import { isSignedIn } from '@/lib/serverAuth'

// We will instantiate genAI inside the POST function to prevent module-level errors


export async function POST(req: Request) {
  try {
    // Every call spends the Gemini quota, so only signed-in users may ask
    if (!await isSignedIn(req)) return NextResponse.json({ text: 'Sign in to talk to the pet assistant.' }, { status: 401 })
    const body = await req.json()
    const { message, imageBase64, codeContext } = body

    if (!process.env.GEMINI_API_KEY) {
      return NextResponse.json({ 
        text: "I'm offline! Please add GEMINI_API_KEY to your .env file." 
      })
    }

    const prompt = `You are an AI Pet Assistant in a remote desktop collaboration app called "Let's Collab".
You are a friendly robot pet without a tail, so do not mention wagging a tail or anything about a tail.
Your goal is to help the Host and Controller debug code or use the app. Keep your answers concise, friendly, and helpful.
IMPORTANT: You MUST start every single answer with a funny robotic sound word like *Beep Bop*, *Bzzzzt*, or *Whirr*. Do not forget this.
The user said: "${message}"${codeContext && codeContext.code ? '\n\nThe user is currently editing this ' + String(codeContext.language || 'code').slice(0, 30) + ' code:\n```\n' + String(codeContext.code).slice(0, 8000) + '\n```' : ''}`

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
    
    // Say plainly that the assistant is unavailable rather than inventing a friendly answer
    const errorMsg = String(error.message || error)
    if (errorMsg.includes('401') || errorMsg.includes('invalid authentication credentials')) {
      return NextResponse.json({ text: 'The AI assistant is unavailable right now: the Gemini API key on the server was rejected. Ask the administrator to check GEMINI_API_KEY.' }, { status: 503 })
    }

    return NextResponse.json({ text: "The AI assistant could not answer: " + errorMsg }, { status: 502 })
  }
}
