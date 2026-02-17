import { NextRequest, NextResponse } from 'next/server'

// Get OpenAI API key from environment variable
const OPENAI_API_KEY = process.env.OPENAI_API_KEY

interface TravelerPreferences {
  travelStyle: string
  crowdTolerance: string
  seasonType?: string
  preferredSeasons?: string[]
  budgetMin?: string
  budgetMax?: string
  safetyOptions: {
    avoidLateNight: boolean
    preferWellLit: boolean
    verifiedTransport: boolean
  }
  notifications: {
    crowd: boolean
    weather: boolean
    price: boolean
    safety: boolean
  }
}

interface Traveler {
  name: string
  gender?: string
  preferences: TravelerPreferences
}

interface TripDetails {
  destination: string
  start_date: string
  end_date: string
}

interface RequestData {
  group_id: string
  trip_details: TripDetails
  travelers: Traveler[]
}

// Build compressed prompt — schema defined ONCE instead of 3×
function buildGeneratePlanPrompt(data: RequestData) {
  const start = new Date(data.trip_details.start_date)
  const end = new Date(data.trip_details.end_date)
  const days = Math.ceil((end.getTime() - start.getTime()) / (1000 * 60 * 60 * 24)) + 1

  const budgets = data.travelers.map(t => ({
    min: parseFloat((t.preferences.budgetMin || '0').toString().replace(/[^0-9.]/g, '')) || 0,
    max: parseFloat((t.preferences.budgetMax || '5000').toString().replace(/[^0-9.]/g, '')) || 5000
  }))
  const groupBudgetMin = Math.max(...budgets.map(b => b.min))
  const groupBudgetMax = Math.min(...budgets.map(b => b.max))

  const seasonTypes = [...new Set(data.travelers.map(t => t.preferences.seasonType || 'no-preference'))]
  const allSeasons = [...new Set(data.travelers.flatMap(t => t.preferences.preferredSeasons || []))]
  const seasonContext = seasonTypes.includes('peak')
    ? `Peak period: ${allSeasons.join(', ')}. Tailor for festivities, higher crowds/prices.`
    : seasonTypes.includes('off-peak')
    ? `Off-peak. Prioritize lower crowds, better prices, sustainability.`
    : seasonTypes.includes('mixed')
    ? `Mixed peak/off-peak: ${allSeasons.join(', ')}. Balance busy and quiet days.`
    : ''

  const dest = data.trip_details.destination
  const dateRange = `${data.trip_details.start_date} to ${data.trip_details.end_date}`

  const prompt = `Generate 3 travel plans for ${dest}, Malaysia. ${days} days, ${data.travelers.length} travelers.
BUDGET: RM ${groupBudgetMin}-${groupBudgetMax}/person. ${seasonContext}

Output a single JSON object with sections in EXACT field order below. Complete each section for ALL 3 plans before moving to the next section.

PLAN_BASIC schema:{"pricePerPerson":"RM X,XXX","description":"10 words max","crowdLevel":"Low/Medium/High Crowd","keyFeatures":["4 items, 5 words"],"benefits":["4 items, 5 words"]}

WINDOW schema:{"optimalPeriod":"dates","priceAdvantage":"X%","priceDirection":"lower|higher","crowdLevel":"Low/Medium/High"}

ANALYTICS schema:{"weather":{"temperature":"X-Y°C","condition":"Sunny|Cloudy|Rainy","icon":"sun|cloud-sun|cloud|cloud-rain","rainChance":30,"humidity":75,"summary":"8 words"},"priceIndex":{"percentChange":-10,"trend":"up|down|stable","hotels":-12,"flights":-8,"activities":-5,"summary":"8 words"},"hotelOccupancy":{"percentage":65,"level":"Low|Medium|High","summary":"8 words"},"crowdLevel":{"data":[{"time":"6am","level":15},{"time":"8am","level":35},{"time":"10am","level":55},{"time":"12pm","level":75},{"time":"2pm","level":70},{"time":"4pm","level":60},{"time":"6pm","level":45},{"time":"9pm","level":25}],"peakTime":"11am-2pm","summary":"8 words"},"traffic":{"data":[{"time":"6am","level":20},{"time":"8am","level":75},{"time":"10am","level":45},{"time":"12pm","level":50},{"time":"2pm","level":40},{"time":"4pm","level":55},{"time":"6pm","level":80},{"time":"9pm","level":30}],"peakDelay":"X min","summary":"8 words"}}

SUSTAINABILITY schema:{"waterUsage":{"value":50,"level":"Low|Medium|High"},"wasteGeneration":{"value":40,"level":"Low|Medium|High"},"energyConsumption":{"value":55,"level":"Low|Medium|High"},"localBusinessSupport":"Low|Medium|High","infrastructurePressure":"Low|Medium|High","culturalPreservation":"Negative|Neutral|Positive","overallScore":72,"overallLabel":"Excellent|Good|Moderate|Poor","summary":"3-4 sentence paragraph about environmental impact specific to ${dest} and plan type in plain language, never list raw numbers","carbonFootprint":{"level":"Low|Medium|High","estimate":"X kg CO2/person","comparison":"X% vs average"},"travelDateAssessment":{"currentDates":{"suitability":"Suitable|Moderate|Not Ideal","reason":"15 words on ${dateRange}"},"recommendedDates":{"period":"date range","reason":"15 words"},"peakSeasons":["2 peak seasons to avoid"],"level":"Low|Medium|High"},"recommendations":[{"tip":"12 words","impact":"High|Medium|Low","category":"Transport|Food|Accommodation|Activity|Waste"},{"tip":"...","impact":"...","category":"..."},{"tip":"...","impact":"...","category":"..."},{"tip":"...","impact":"...","category":"..."},{"tip":"...","impact":"...","category":"..."},{"tip":"...","impact":"...","category":"..."}]}

ALERTS schema:{"crowd":[{"title":"5 words","location":"real ${dest} place","time":"when","level":"HIGH|MEDIUM|LOW","levelType":"danger|warning|info|success","description":"12 words","suggestion":"10 words"}],"weather":[{"title":"5 words","location":"real place","time":"when","level":"WARNING|INFO","levelType":"warning|info","description":"12 words","suggestion":"10 words"}],"price":[{"title":"5 words","location":"real venue","time":"when","level":"DEAL|INFO","levelType":"success|info","description":"12 words","suggestion":"10 words"}],"safety":[{"title":"5 words","location":"real street","time":"when","level":"CAUTION|INFO","levelType":"warning|info","description":"12 words","suggestion":"10 words"}]}

SUGGESTIONS schema:[{"title":"3-4 words","description":"10 words"},{"title":"...","description":"..."},{"title":"...","description":"..."},{"title":"...","description":"..."}]

Return:{"summary":{"destination":"${dest}","duration":"${days} days","travelers":${data.travelers.length},"dateRange":"${dateRange}","groupBudget":"RM ${groupBudgetMin} - RM ${groupBudgetMax}","highlights":["3 highlights"]},"plans":{"Budget Friendly":<PLAN_BASIC>,"Balanced Explorer":<PLAN_BASIC>,"Premium Experience":<PLAN_BASIC>},"bestWindow":{"Budget Friendly":<WINDOW>,"Balanced Explorer":<WINDOW>,"Premium Experience":<WINDOW>},"analytics":{"Budget Friendly":<ANALYTICS>,"Balanced Explorer":<ANALYTICS>,"Premium Experience":<ANALYTICS>},"sustainability":{"Budget Friendly":<SUSTAINABILITY>,"Balanced Explorer":<SUSTAINABILITY>,"Premium Experience":<SUSTAINABILITY>},"alerts":{"Budget Friendly":<ALERTS>,"Balanced Explorer":<ALERTS>,"Premium Experience":<ALERTS>},"suggestions":{"Budget Friendly":<SUGGESTIONS>,"Balanced Explorer":<SUGGESTIONS>,"Premium Experience":<SUGGESTIONS>}}

RULES: Output JSON sections in EXACT field order shown above. Different prices/data/sustainability per plan. Real ${dest} locations. 8 chart data points. Budget=higher sustainability. 6 eco tips per plan. Valid JSON only.`

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

// Default fallback plan data
function getDefaultPlanData(destination: string, days: number, travelers: number) {
  const createDefaultPlan = (name: string, price: string, crowd: string, priceDir: string) => ({
    pricePerPerson: price,
    description: `A ${name.toLowerCase()} approach to exploring ${destination}`,
    crowdLevel: crowd,
    keyFeatures: [
      'Curated attractions and activities',
      'Flexible scheduling options',
      'Local dining recommendations',
      'Transportation guidance'
    ],
    benefits: [
      'Personalized experience',
      'Time-efficient planning',
      'Cost-effective choices',
      'Memorable moments'
    ],
    bestWindow: {
      optimalPeriod: 'Check dates for optimal timing',
      priceAdvantage: '10-15% lower',
      priceDirection: priceDir,
      crowdLevel: 'Medium'
    },
    analytics: {
      weather: {
        temperature: '28-33°C',
        condition: 'Partly Cloudy',
        icon: 'cloud-sun',
        rainChance: 30,
        humidity: 75,
        summary: 'Typical tropical weather expected'
      },
      priceIndex: {
        percentChange: -10,
        trend: 'down',
        hotels: -12,
        flights: -8,
        activities: -5,
        summary: 'Moderate pricing for the period'
      },
      hotelOccupancy: {
        percentage: 65,
        level: 'Medium',
        summary: 'Good availability expected'
      },
      crowdLevel: {
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
        peakTime: '11am-2pm',
        summary: 'Visit early morning for fewer crowds'
      },
      traffic: {
        data: [
          { time: '6am', level: 20 },
          { time: '8am', level: 75 },
          { time: '10am', level: 45 },
          { time: '12pm', level: 50 },
          { time: '2pm', level: 40 },
          { time: '4pm', level: 55 },
          { time: '6pm', level: 80 },
          { time: '9pm', level: 30 }
        ],
        peakDelay: '15-25 min',
        summary: 'Avoid rush hours 8-9am and 5-7pm'
      }
    },
    sustainability: {
      waterUsage: { value: 50, level: 'Medium' },
      wasteGeneration: { value: 40, level: 'Low' },
      energyConsumption: { value: 55, level: 'Medium' },
      localBusinessSupport: 'Medium',
      infrastructurePressure: 'Medium',
      culturalPreservation: 'Positive',
      overallScore: 68,
      overallLabel: 'Good',
      summary: `This plan has a good sustainability profile for ${destination}. Water usage is moderate due to standard hotel facilities, while waste generation remains low thanks to local dining options. Energy consumption is moderate from air-conditioned transport. The plan supports local businesses at a medium level and has a positive impact on cultural preservation through heritage site visits.`,
      carbonFootprint: {
        level: 'Medium',
        estimate: '45 kg CO2 per person',
        comparison: '12% lower than average tourist'
      },
      travelDateAssessment: {
        currentDates: {
          suitability: 'Moderate',
          reason: 'Standard tourist season with average environmental impact'
        },
        recommendedDates: {
          period: 'Early March or late September',
          reason: 'Lower crowds reduce environmental strain and infrastructure pressure'
        },
        peakSeasons: ['School holidays (March, November)', 'Chinese New Year period'],
        level: 'Medium'
      },
      recommendations: [
        { tip: 'Use public transport or walk to reduce carbon emissions', impact: 'High', category: 'Transport' },
        { tip: 'Support local vendors and restaurants over chain businesses', impact: 'High', category: 'Food' },
        { tip: 'Carry reusable water bottles to minimize plastic waste', impact: 'Medium', category: 'Waste' },
        { tip: 'Visit heritage sites during off-peak hours to reduce pressure', impact: 'Medium', category: 'Activity' },
        { tip: 'Choose eco-certified accommodations when available', impact: 'High', category: 'Accommodation' },
        { tip: 'Avoid single-use plastics at food stalls and markets', impact: 'Low', category: 'Waste' }
      ]
    },
    alerts: {
      crowd: [
        { title: 'Crowd Alert', location: 'Main Square', time: 'Weekends', level: 'MEDIUM', levelType: 'warning', description: 'Moderate crowds expected.', suggestion: 'Visit on weekdays.' }
      ],
      weather: [
        { title: 'Weather Notice', location: 'Waterfront Area', time: 'Afternoon', level: 'INFO', levelType: 'info', description: 'Afternoon showers common.', suggestion: 'Carry an umbrella.' }
      ],
      price: [
        { title: 'Price Alert', location: 'Holiday Inn Express', time: 'Current', level: 'DEAL', levelType: 'success', description: 'Good rates available.', suggestion: 'Book in advance.' }
      ],
      safety: [
        { title: 'Safety Tip', location: 'Night Market Street', time: 'Night', level: 'CAUTION', levelType: 'warning', description: 'Stay in well-lit areas.', suggestion: 'Use verified transport.' }
      ]
    },
    suggestions: [
      { title: 'Early Bird Visits', description: 'Start your day early to beat the crowds at popular attractions.' },
      { title: 'Local Cuisine', description: 'Try local restaurants for authentic flavors and better value.' },
      { title: 'Book Ahead', description: 'Reserve accommodations and activities in advance.' },
      { title: 'Stay Flexible', description: 'Keep some free time for spontaneous discoveries.' }
    ]
  })

  return {
    summary: {
      destination,
      duration: `${days} days`,
      travelers,
      dateRange: 'Selected dates',
      groupBudget: 'Flexible',
      highlights: [`Explore ${destination}`, 'Experience local culture', 'Create lasting memories']
    },
    plans: {
      'Serenity Escape': createDefaultPlan('Peaceful', 'RM 1,200', 'Low-Medium Crowd', 'lower'),
      'Adventure Blend': createDefaultPlan('Balanced', 'RM 1,000', 'Medium Crowd', 'lower'),
      'Smart Saver': createDefaultPlan('Budget-Friendly', 'RM 800', 'Medium-High Crowd', 'lower')
    }
  }
}

export async function POST(request: NextRequest) {
  try {
    const data: RequestData = await request.json()

    // Validation
    const requiredFields = ['group_id', 'trip_details', 'travelers'] as const
    for (const field of requiredFields) {
      if (!data[field]) {
        return NextResponse.json(
          { success: false, error: `Missing required field: ${field}` },
          { status: 400 }
        )
      }
    }

    if (!data.trip_details.destination || !data.trip_details.start_date || !data.trip_details.end_date) {
      return NextResponse.json(
        { success: false, error: 'trip_details must contain: destination, start_date, end_date' },
        { status: 400 }
      )
    }

    if (!Array.isArray(data.travelers)) {
      return NextResponse.json(
        { success: false, error: 'travelers must be an array' },
        { status: 400 }
      )
    }

    const { prompt, days } = buildGeneratePlanPrompt(data)

    if (!OPENAI_API_KEY) {
      const fallback = getDefaultPlanData(data.trip_details.destination, days, data.travelers.length)
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
            { role: 'system', content: 'Malaysian travel planner. Return concise JSON only. Keep text under 10 words.' },
            { role: 'user', content: prompt },
          ],
          max_completion_tokens: 8000,
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
      const fallback = getDefaultPlanData(data.trip_details.destination, days, data.travelers.length)
      return new Response(JSON.stringify(fallback), {
        headers: { 'Content-Type': 'text/plain; charset=utf-8' },
      })
    }
  } catch (error) {
    return NextResponse.json(
      {
        success: false,
        error: error instanceof Error ? error.message : 'Failed to generate/save travel plan'
      },
      { status: 500 }
    )
  }
}

export async function GET() {
  return NextResponse.json({
    status: 'ok',
    message: 'Travel Plan API v4 - Streaming & Optimized',
    features: [
      '3 unique plans (concise content)',
      'Streaming response with gpt-5.2',
      '8-point chart data',
      '1 alert per category',
      '4 suggestions per plan'
    ]
  })
}
