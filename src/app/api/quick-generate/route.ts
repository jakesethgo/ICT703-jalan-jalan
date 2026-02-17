import { NextRequest, NextResponse } from 'next/server'

const OPENAI_API_KEY = process.env.OPENAI_API_KEY

interface RequestData {
  destination: string
  start_date: string
  end_date: string
  travelers: number
}

// Build compressed prompt for quick predictions
function buildQuickPrompt(data: RequestData) {
  const start = new Date(data.start_date)
  const end = new Date(data.end_date)
  const days = Math.ceil((end.getTime() - start.getTime()) / (1000 * 60 * 60 * 24)) + 1

  const prompt = `Travel predictions for ${data.destination}, Malaysia. ${days} days.

Output a single JSON object with fields in EXACT order below. Complete each section fully before moving to the next.

Return JSON:{"summary":{"destination":"${data.destination}","duration":"${days} days","estimatedBudget":"RM 800 - RM 1,500","highlights":["3 real highlights"]},"topAttractions":[{"name":"Real name","type":"Culture|Nature|Food|Adventure","tip":"visit tip"},{"name":"...","type":"...","tip":"..."},{"name":"...","type":"...","tip":"..."},{"name":"...","type":"...","tip":"..."},{"name":"...","type":"...","tip":"..."}],"predictions":{"weather":{"temperature":"28-32°C","condition":"Partly Cloudy","icon":"cloud-sun","rainChance":30,"humidity":75,"summary":"brief"},"crowdLevel":{"overall":"Medium","percentage":60,"peakHours":"11am - 2pm","summary":"brief","data":[{"time":"6am","level":15},{"time":"8am","level":35},{"time":"10am","level":55},{"time":"12pm","level":75},{"time":"2pm","level":70},{"time":"4pm","level":60},{"time":"6pm","level":45},{"time":"9pm","level":25}]},"pricing":{"trend":"stable","percentChange":-5,"summary":"brief"},"traffic":{"peakDelay":"15-25 min","summary":"brief","data":[{"time":"6am","level":20},{"time":"8am","level":75},{"time":"10am","level":45},{"time":"12pm","level":50},{"time":"2pm","level":40},{"time":"4pm","level":55},{"time":"6pm","level":80},{"time":"9pm","level":30}]},"hotelOccupancy":{"percentage":65,"summary":"brief"}},"quickTips":[{"title":"tip","description":"desc"},{"title":"...","description":"..."},{"title":"...","description":"..."},{"title":"...","description":"..."}]}

Use REAL ${data.destination} data. Pick ONE weather condition. Valid JSON only.`

  return { prompt, days }
}

// Stream OpenAI SSE response content tokens to client
function createOpenAIStream(openaiResponse: Response): ReadableStream<Uint8Array> {
  const encoder = new TextEncoder()
  const decoder = new TextDecoder()

  return new ReadableStream({
    async start(controller) {
      const reader = openaiResponse.body!.getReader()
      let buffer = ''

      try {
        while (true) {
          const { done, value } = await reader.read()
          if (done) break

          buffer += decoder.decode(value, { stream: true })
          const lines = buffer.split('\n')
          buffer = lines.pop() || ''

          for (const line of lines) {
            const trimmed = line.trim()
            if (!trimmed || !trimmed.startsWith('data: ')) continue
            if (trimmed === 'data: [DONE]') continue

            try {
              const parsed = JSON.parse(trimmed.slice(6))
              const content = parsed.choices?.[0]?.delta?.content
              if (content) {
                controller.enqueue(encoder.encode(content))
              }
            } catch {
              // skip malformed SSE chunks
            }
          }
        }
      } catch (e) {
        controller.error(e)
        return
      }

      controller.close()
    },
  })
}

// Default fallback data
function getDefaultQuickData(destination: string, days: number, travelers: number) {
  return {
    summary: {
      destination,
      duration: `${days} days`,
      travelers,
      dateRange: 'Selected dates',
      estimatedBudget: 'RM 500 - RM 1,500 per person',
      highlights: ['Rich cultural heritage', 'Delicious local cuisine', 'Beautiful scenery'],
      bestTimeToVisit: 'Early morning or late afternoon',
      travelTip: 'Book accommodations in advance during peak season'
    },
    predictions: {
      weather: {
        temperature: '28-33°C',
        condition: 'Partly Cloudy',
        icon: 'cloud-sun',
        rainChance: 30,
        humidity: 75,
        summary: 'Typical tropical weather expected',
        forecast: Array.from({ length: days }, (_, i) => ({
          day: `Day ${i + 1}`,
          condition: 'Partly Cloudy',
          temp: '29°C',
          rain: 25
        }))
      },
      crowdLevel: {
        overall: 'Medium',
        percentage: 60,
        summary: 'Moderate crowds expected during your visit',
        data: [
          { time: '6am', level: 15 },
          { time: '8am', level: 35 },
          { time: '10am', level: 55 },
          { time: '12pm', level: 75 },
          { time: '2pm', level: 70 },
          { time: '4pm', level: 60 },
          { time: '6pm', level: 45 },
          { time: '9pm', level: 25 }
        ],
        peakHours: '11am - 2pm',
        bestTimeToVisit: 'Early morning or evening'
      },
      pricing: {
        trend: 'stable',
        percentChange: -5,
        summary: 'Prices are stable for this period',
        breakdown: {
          accommodation: 'RM 80 - RM 300/night',
          food: 'RM 30 - RM 80/day',
          transport: 'RM 20 - RM 50/day',
          activities: 'RM 30 - RM 100/day'
        }
      },
      traffic: {
        summary: 'Moderate traffic, avoid rush hours',
        peakDelay: '15-25 min',
        data: [
          { time: '6am', level: 20 },
          { time: '8am', level: 75 },
          { time: '10am', level: 45 },
          { time: '12pm', level: 50 },
          { time: '2pm', level: 40 },
          { time: '4pm', level: 55 },
          { time: '6pm', level: 80 },
          { time: '9pm', level: 30 }
        ]
      },
      hotelOccupancy: {
        percentage: 65,
        level: 'Medium',
        summary: 'Good availability expected'
      }
    },
    topAttractions: [
      { name: 'Main Historical Site', category: 'Culture', crowdLevel: 'Medium', estimatedTime: '2-3 hours', tip: 'Visit early morning' },
      { name: 'Local Market', category: 'Food', crowdLevel: 'High', estimatedTime: '1-2 hours', tip: 'Best in the evening' },
      { name: 'Nature Park', category: 'Nature', crowdLevel: 'Low', estimatedTime: '3-4 hours', tip: 'Bring water and sunscreen' },
      { name: 'Cultural Museum', category: 'Culture', crowdLevel: 'Low', estimatedTime: '1-2 hours', tip: 'Free entry on weekends' },
      { name: 'Scenic Viewpoint', category: 'Nature', crowdLevel: 'Medium', estimatedTime: '1 hour', tip: 'Best at sunset' }
    ],
    alerts: [
      { type: 'weather', title: 'Afternoon Showers', description: 'Brief rain showers common in the afternoon', level: 'info', location: destination },
      { type: 'crowd', title: 'Weekend Rush', description: 'Popular spots get crowded on weekends', level: 'warning', location: 'Tourist Areas' },
      { type: 'price', title: 'Good Deals', description: 'Off-peak pricing available for accommodations', level: 'success', location: 'City Center' }
    ],
    quickTips: [
      { title: 'Stay Hydrated', description: 'Carry water, tropical weather can be dehydrating' },
      { title: 'Local Transport', description: 'Use Grab app for convenient transportation' },
      { title: 'Cash Ready', description: 'Some local vendors only accept cash' },
      { title: 'Sun Protection', description: 'Bring sunscreen and hat for outdoor activities' }
    ]
  }
}

export async function POST(request: NextRequest) {
  try {
    const data: RequestData = await request.json()

    // Validation
    if (!data.destination || !data.start_date || !data.end_date) {
      return NextResponse.json(
        { success: false, error: 'Missing required fields: destination, start_date, end_date' },
        { status: 400 }
      )
    }

    const { prompt, days } = buildQuickPrompt(data)

    if (!OPENAI_API_KEY) {
      const fallback = getDefaultQuickData(data.destination, days, data.travelers || 1)
      return new Response(JSON.stringify(fallback), {
        headers: { 'Content-Type': 'text/plain; charset=utf-8' },
      })
    }

    try {
      const openaiResponse = await fetch('https://api.openai.com/v1/chat/completions', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${OPENAI_API_KEY}`,
        },
        body: JSON.stringify({
          model: 'gpt-5.2',
          stream: true,
          temperature: 0,
          messages: [
            { role: 'system', content: 'Malaysian travel advisor. Return concise JSON with real destination data.' },
            { role: 'user', content: prompt },
          ],
          max_completion_tokens: 4000,
          response_format: { type: 'json_object' },
        }),
      })

      if (!openaiResponse.ok) {
        const errorData = await openaiResponse.json().catch(() => ({}))
        throw new Error(`OpenAI: ${openaiResponse.status} - ${errorData.error?.message || 'Unknown error'}`)
      }

      return new Response(createOpenAIStream(openaiResponse), {
        headers: {
          'Content-Type': 'text/plain; charset=utf-8',
          'Cache-Control': 'no-cache',
        },
      })
    } catch {
      console.error('OpenAI error, using fallback')
      const fallback = getDefaultQuickData(data.destination, days, data.travelers || 1)
      return new Response(JSON.stringify(fallback), {
        headers: { 'Content-Type': 'text/plain; charset=utf-8' },
      })
    }
  } catch (error) {
    return NextResponse.json(
      {
        success: false,
        error: error instanceof Error ? error.message : 'Failed to generate quick prediction'
      },
      { status: 500 }
    )
  }
}

export async function GET() {
  return NextResponse.json({
    status: 'ok',
    message: 'Quick Generate API - Streaming & Optimized',
    features: [
      'General destination overview',
      'Weather & crowd predictions',
      'Streaming response with gpt-5.2',
      'Quick tips'
    ]
  })
}
