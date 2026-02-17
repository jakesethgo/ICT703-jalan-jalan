"use client"

import { useState, useMemo, useEffect, useCallback, useRef } from 'react'
import { useRouter } from 'next/navigation'
import {
  Users, Calendar, Plane,
  CloudRain, CloudSun, Sun, Thermometer, Cloud,
  Tag, Shield, ChevronLeft, Share2,
  Clock, Plus, Minus, Car, Building2, AlertTriangle,
  ArrowRight, Sparkles, CheckCircle2, Zap,
  MapPin as MapPinIcon, DollarSign, Bell, Brain, Lightbulb, X, Wand2,
  TrendingUp, TrendingDown, BarChart3, Activity, Leaf, Info, ExternalLink, Settings2, CalendarCheck, CalendarX, Recycle, Footprints, TreePine, Utensils, BedDouble, CircleDot,
  Mail, MessageCircle, Facebook, Instagram, AtSign, UserPlus, UserMinus,
  Copy, Link, RefreshCw, Loader2, ArrowUp
} from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Badge } from '@/components/ui/badge'
import { Separator } from '@/components/ui/separator'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { RadioGroup, RadioGroupItem } from '@/components/ui/radio-group'
import { Tabs, TabsList, TabsTrigger, TabsContent } from '@/components/ui/tabs'
import { Checkbox } from '@/components/ui/checkbox'
import { Label } from '@/components/ui/label'
import { Input } from '@/components/ui/input'
import { DatePicker } from '@/components/ui/date-picker'
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover'
import { ScrollArea } from '@/components/ui/scroll-area'
import { Switch } from '@/components/ui/switch'
import { type DateRange } from "react-day-picker"
import { PageLayout } from '@/components/shared/page-layout'
import { detectPeakPeriods } from '@/lib/malaysian-peak-periods'
import { GroupLabel } from '@/components/shared/group-label'
import { ChartContainer, ChartTooltip, ChartTooltipContent } from '@/components/ui/chart'
import { Bar, BarChart, Line, LineChart, XAxis, YAxis } from 'recharts'

// Read streamed JSON response from API with real-time progress tracking
// Attempt to parse incomplete JSON by closing open structures
// eslint-disable-next-line @typescript-eslint/no-explicit-any
function tryParsePartialJSON(text: string): any {
  let str = text.trim()
  if (!str) return null
  try { return JSON.parse(str) } catch { /* continue to repair */ }

  let inStr = false
  let esc = false
  const stack: string[] = []
  for (const ch of str) {
    if (esc) { esc = false; continue }
    if (ch === '\\' && inStr) { esc = true; continue }
    if (ch === '"') { inStr = !inStr; continue }
    if (inStr) continue
    if (ch === '{') stack.push('}')
    else if (ch === '[') stack.push(']')
    else if (ch === '}' || ch === ']') stack.pop()
  }
  if (inStr) str += '"'
  str = str.replace(/,\s*$/, '')
  while (stack.length) str += stack.pop()
  try { return JSON.parse(str) } catch { return null }
}

// Detect which sections are FULLY ready in the streamed data (section-based structure).
// Each check is strict — all sub-fields must be present before revealing.
// eslint-disable-next-line @typescript-eslint/no-explicit-any
function detectStreamSections(data: any): Set<string> {
  const sections = new Set<string>()
  if (!data?.plans) return sections
  const planKeys = Object.keys(data.plans)

  // Plans + Details: all 3 plans must have basic info with benefits (last field in basic schema)
  if (planKeys.length >= 3 && planKeys.every(k => {
    const p = data.plans[k]
    return p?.pricePerPerson && p?.keyFeatures?.length > 0 && p?.benefits?.length > 0
  })) {
    sections.add('f-plans')
    sections.add('f-details')
  }

  // Use first plan key as sentinel for each section
  const first = planKeys[0]
  if (!first) return sections

  // Best Window: needs all 3 core fields
  const bw = data.bestWindow?.[first]
  if (bw?.optimalPeriod && bw?.priceAdvantage && bw?.crowdLevel) {
    sections.add('f-window')
  }

  // Analytics: needs weather + priceIndex + crowdLevel.data + traffic.data
  const an = data.analytics?.[first]
  if (an?.weather?.temperature && an?.priceIndex?.trend &&
      an?.crowdLevel?.data?.length >= 8 && an?.traffic?.data?.length >= 8) {
    sections.add('f-analytics')
  }

  // Sustainability: needs overallScore + overallLabel + summary paragraph + recommendations array
  const su = data.sustainability?.[first]
  if (su?.overallScore !== undefined && su?.overallLabel &&
      typeof su?.summary === 'string' && su.summary.length > 20 &&
      su?.recommendations?.length >= 4) {
    sections.add('f-sustainability')
  }

  // Alerts: all 4 types must be present with at least 1 item each
  const al = data.alerts?.[first]
  if (al?.crowd?.length > 0 && al?.weather?.length > 0 &&
      al?.price?.length > 0 && al?.safety?.length > 0) {
    sections.add('f-alerts')
  }

  // Suggestions: need at least 3 items with title + description
  const sg = data.suggestions?.[first]
  if (sg?.length >= 3 && sg.every((s: any) => s?.title && s?.description)) {
    sections.add('f-suggestions')
  }

  return sections
}

// Detect which quick-generate sections are FULLY ready to render
// eslint-disable-next-line @typescript-eslint/no-explicit-any
function detectQuickSections(data: any): Set<string> {
  const sections = new Set<string>()
  // Overview: needs summary + topAttractions with items
  if (data?.summary?.destination && data?.topAttractions?.length >= 3) {
    sections.add('q-overview')
  }
  // Analytics: needs weather + crowdLevel + pricing + traffic
  if (data?.predictions?.weather?.temperature && data?.predictions?.crowdLevel?.data?.length >= 8 &&
      data?.predictions?.pricing?.trend && data?.predictions?.traffic?.data?.length >= 8) {
    sections.add('q-analytics')
  }
  // Tips: need at least 3 items with title + description
  if (data?.quickTips?.length >= 3 && data.quickTips.every((t: any) => t?.title && t?.description)) {
    sections.add('q-tips')
  }
  return sections
}

// Fix potentially nested plans structure from OpenAI
// eslint-disable-next-line @typescript-eslint/no-explicit-any
function fixNestedPlans(data: any) {
  if (data.plans) {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const flatPlans: Record<string, any> = {}
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const extractPlans = (obj: any, depth = 0) => {
      if (depth > 5) return
      for (const [key, value] of Object.entries(obj)) {
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        if (value && typeof value === 'object' && 'pricePerPerson' in (value as any)) {
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          const planCopy = { ...(value as Record<string, any>) }
          for (const [innerKey, innerValue] of Object.entries(planCopy)) {
            // eslint-disable-next-line @typescript-eslint/no-explicit-any
            if (innerValue && typeof innerValue === 'object' && 'pricePerPerson' in (innerValue as any)) {
              delete planCopy[innerKey]
              extractPlans({ [innerKey]: innerValue }, depth + 1)
            }
          }
          flatPlans[key] = planCopy
        }
      }
    }
    extractPlans(data.plans)
    if (Object.keys(flatPlans).length > 0) {
      data.plans = flatPlans
    }
  }
  return data
}

async function readStreamedJSON(
  response: Response,
  onProgress?: (progress: number) => void,
  expectedSize: number = 10000,
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  onPartialData?: (data: any) => void
) {
  const reader = response.body!.getReader()
  const decoder = new TextDecoder()
  let text = ''
  let lastParseLen = 0

  while (true) {
    const { done, value } = await reader.read()
    if (done) break
    text += decoder.decode(value, { stream: true })
    if (onProgress) {
      const rawProgress = Math.min(text.length / expectedSize, 1)
      const mapped = 10 + rawProgress * 75
      onProgress(mapped)
    }
    // Try partial JSON parsing every ~500 chars of new data
    if (onPartialData && text.length - lastParseLen > 300) {
      lastParseLen = text.length
      const partial = tryParsePartialJSON(text)
      if (partial) onPartialData(partial)
    }
  }

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const data = JSON.parse(text) as any
  return fixNestedPlans(data)
}

// Simplified 3-step flow
type Step = 'details' | 'preferences' | 'results'

interface TripData {
  destination: string
  dateRange: DateRange | undefined
  travelers: number
  travelerNames: string[]
  travelerGenders: string[]
}

interface Preferences {
  travelStyle: string
  crowdTolerance: string
  seasonType: string
  preferredSeasons: string[]
  safetyOptions: {
    avoidLateNight: boolean
    preferWellLit: boolean
    verifiedTransport: boolean
  }
  budgetMin: string
  budgetMax: string
  notifications: {
    crowd: boolean
    weather: boolean
    price: boolean
    safety: boolean
  }
}

// --- Skeleton section header ---
function SkeletonHeader({ title, icon: Icon, delay = '0s' }: { title: string; icon: React.ElementType; delay?: string }) {
  return (
    <div className="flex items-center gap-2 mb-3 animate-fade-in-up" style={{ animationDelay: delay, animationFillMode: 'backwards' }}>
      <Icon className="h-4 w-4 text-rose-400" />
      <h3 className="text-sm font-semibold text-muted-foreground">{title}</h3>
      <span className="text-xs text-rose-500 animate-pulse ml-1">Generating...</span>
    </div>
  )
}

const shimmer = 'bg-rose-100/70 dark:bg-rose-900/20 animate-pulse rounded-md'
const shimmerLg = 'bg-rose-50 dark:bg-rose-950/20 animate-pulse rounded-lg'

// --- Quick Generate Skeletons ---

function QuickOverviewSkeleton() {
  return (
    <div className="rounded-xl border bg-gradient-to-br from-rose-50 to-transparent dark:from-rose-950/20 dark:to-transparent p-4 animate-fade-in-up" style={{ animationDelay: '0.1s', animationFillMode: 'backwards' }}>
      <div className="flex items-center gap-2 mb-4">
        <div className="w-8 h-8 rounded-lg bg-rose-100 dark:bg-rose-900/30 flex items-center justify-center">
          <Sparkles className="h-4 w-4 text-rose-400" />
        </div>
        <h3 className="text-sm font-semibold text-muted-foreground">Quick Overview</h3>
        <span className="text-xs text-rose-500 animate-pulse ml-1">Generating...</span>
      </div>
      <div className="grid sm:grid-cols-2 gap-4">
        {/* Left — budget + badges */}
        <div className="space-y-3">
          <div>
            <div className={`h-3 w-24 ${shimmer} mb-2`} />
            <div className={`h-8 w-40 ${shimmer} mb-1`} />
            <div className={`h-3 w-16 ${shimmer}`} />
          </div>
          <div className="flex flex-wrap gap-1.5">
            <div className={`h-6 w-20 ${shimmerLg}`} />
            <div className={`h-6 w-24 ${shimmerLg}`} />
            <div className={`h-6 w-16 ${shimmerLg}`} />
          </div>
        </div>
        {/* Right — 2×2 stat grid */}
        <div className="grid grid-cols-2 gap-2">
          {[0,1,2,3].map(i => (
            <div key={i} className="flex items-center gap-2.5 p-3 rounded-lg border border-rose-100 dark:border-rose-900/30 bg-white/60 dark:bg-white/5">
              <div className={`h-4 w-4 rounded ${shimmer}`} />
              <div className="space-y-1.5 flex-1">
                <div className={`h-3 w-12 ${shimmer}`} />
                <div className={`h-4 w-16 ${shimmer}`} />
              </div>
            </div>
          ))}
        </div>
      </div>
    </div>
  )
}

function PredictiveAnalyticsSkeleton({ delay = '0.2s' }: { delay?: string }) {
  return (
    <div className="animate-fade-in-up" style={{ animationDelay: delay, animationFillMode: 'backwards' }}>
      <SkeletonHeader title="Predictive Analytics" icon={BarChart3} delay={delay} />
      {/* Weather & Price row */}
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 mb-3">
        {[0,1].map(i => (
          <div key={i} className="rounded-xl border bg-card p-4">
            <div className="flex items-start justify-between">
              <div className="space-y-2 flex-1">
                <div className={`h-3 w-24 ${shimmer}`} />
                <div className={`h-7 w-28 ${shimmer}`} />
                <div className={`h-3.5 w-20 ${shimmer}`} />
              </div>
              <div className={`w-12 h-12 rounded-full ${shimmerLg}`} />
            </div>
            <div className="flex items-center gap-4 mt-4 pt-3 border-t">
              <div className={`h-7 w-20 ${shimmerLg}`} />
              <div className={`h-7 w-24 ${shimmerLg}`} />
            </div>
          </div>
        ))}
      </div>
      {/* 3-col analytics grid */}
      <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
        {[0,1,2].map(i => (
          <div key={i} className="rounded-xl border bg-card p-4">
            <div className="flex items-center gap-2 mb-3">
              <div className={`w-8 h-8 ${shimmerLg}`} />
              <div className={`h-4 w-24 ${shimmer}`} />
            </div>
            <div className={`h-6 w-16 ${shimmer} mb-3`} />
            <div className={`h-[72px] w-full ${shimmerLg} mb-3`} />
            <div className={`h-3 w-full ${shimmer}`} />
          </div>
        ))}
      </div>
    </div>
  )
}

function QuickTipsSkeleton() {
  return (
    <div className="rounded-xl border bg-gradient-to-br from-rose-50 to-transparent dark:from-rose-950/20 dark:to-transparent p-4 animate-fade-in-up" style={{ animationDelay: '0.4s', animationFillMode: 'backwards' }}>
      <div className="flex items-center gap-2 mb-4">
        <div className="w-8 h-8 rounded-lg bg-rose-100 dark:bg-rose-900/30 flex items-center justify-center">
          <Lightbulb className="h-4 w-4 text-rose-400" />
        </div>
        <h3 className="text-sm font-semibold text-muted-foreground">Quick Tips</h3>
        <span className="text-xs text-rose-500 animate-pulse ml-1">Generating...</span>
      </div>
      <div className="grid sm:grid-cols-2 gap-3">
        {[0,1,2,3].map(i => (
          <div key={i} className="flex items-start gap-3 p-4 rounded-lg bg-background/60 border">
            <div className="w-8 h-8 rounded-full bg-rose-200 dark:bg-rose-800/40 animate-pulse shrink-0" />
            <div className="flex-1 space-y-2">
              <div className={`h-4 w-28 ${shimmer}`} />
              <div className={`h-3 w-full ${shimmer}`} />
              <div className={`h-3 w-3/4 ${shimmer}`} />
            </div>
          </div>
        ))}
      </div>
    </div>
  )
}

// --- Full Plan Skeletons ---

function PlanSelectionSkeleton() {
  return (
    <div className="animate-fade-in-up" style={{ animationDelay: '0.1s', animationFillMode: 'backwards' }}>
      <SkeletonHeader title="Choose Your Plan" icon={Sparkles} delay="0.1s" />
      <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
        {[0,1,2].map(i => (
          <div key={i} className="rounded-xl border bg-card p-5 space-y-3">
            {i === 1 && <div className="flex justify-center -mt-2 mb-1"><div className={`h-5 w-24 ${shimmerLg}`} /></div>}
            <div className="flex items-start justify-between gap-2">
              <div className={`h-5 w-32 ${shimmer}`} />
              <div className={`w-5 h-5 rounded-full ${shimmerLg}`} />
            </div>
            <div className="space-y-1.5 min-h-[40px]">
              <div className={`h-3.5 w-full ${shimmer}`} />
              <div className={`h-3.5 w-3/4 ${shimmer}`} />
            </div>
            <div className={`h-8 w-28 ${shimmer}`} />
            <div className="flex items-center gap-2">
              <div className={`h-7 w-24 ${shimmerLg}`} />
              <div className={`h-7 w-20 ${shimmerLg}`} />
            </div>
            <div className="pt-3 border-t space-y-2">
              <div className={`h-3 w-24 ${shimmer}`} />
              <div className="flex gap-1.5">
                {[0,1].map(j => (
                  <div key={j} className={`h-7 w-16 ${shimmerLg}`} />
                ))}
              </div>
            </div>
          </div>
        ))}
      </div>
    </div>
  )
}

function PlanDetailsSkeleton() {
  return (
    <div className="animate-fade-in-up" style={{ animationDelay: '0.2s', animationFillMode: 'backwards' }}>
      <SkeletonHeader title="Plan Details" icon={Info} delay="0.2s" />
      <div className="grid sm:grid-cols-2 gap-3">
        {[0,1].map(col => (
          <div key={col} className="rounded-xl border bg-card p-4">
            <div className="flex items-center gap-2 mb-3">
              <div className={`w-8 h-8 ${shimmerLg}`} />
              <div className={`h-4 w-24 ${shimmer}`} />
            </div>
            <div className="space-y-2.5">
              {[0,1,2].map(i => (
                <div key={i} className="flex items-start gap-2.5 p-2 rounded-lg bg-muted/30">
                  <div className={`h-4 w-4 rounded-full ${shimmer} mt-0.5 shrink-0`} />
                  <div className="flex-1 space-y-1">
                    <div className={`h-3.5 w-full ${shimmer}`} />
                    <div className={`h-3.5 w-2/3 ${shimmer}`} />
                  </div>
                </div>
              ))}
            </div>
          </div>
        ))}
      </div>
    </div>
  )
}

function BestWindowSkeleton() {
  return (
    <div className="animate-fade-in-up" style={{ animationDelay: '0.3s', animationFillMode: 'backwards' }}>
      <SkeletonHeader title="Best Travel Window" icon={Clock} delay="0.3s" />
      <div className="grid grid-cols-3 gap-3">
        {[0,1,2].map(i => (
          <div key={i} className="rounded-xl border bg-card p-4 text-center">
            <div className={`w-10 h-10 rounded-full ${shimmerLg} mx-auto mb-3`} />
            <div className={`h-3 w-20 ${shimmer} mx-auto mb-2`} />
            <div className={`h-4 w-24 ${shimmer} mx-auto`} />
          </div>
        ))}
      </div>
    </div>
  )
}

function SustainabilitySkeleton() {
  return (
    <div className="rounded-xl border bg-gradient-to-br from-rose-50 to-transparent dark:from-rose-950/20 dark:to-transparent p-4 animate-fade-in-up" style={{ animationDelay: '0.5s', animationFillMode: 'backwards' }}>
      <div className="flex items-center gap-2 mb-4">
        <div className="w-8 h-8 rounded-lg bg-rose-100 dark:bg-rose-900/30 flex items-center justify-center">
          <Leaf className="h-4 w-4 text-rose-400" />
        </div>
        <h3 className="text-sm font-semibold text-muted-foreground">Sustainability Dashboard</h3>
        <span className="text-xs text-rose-500 animate-pulse ml-1">Generating...</span>
      </div>
      <div className="grid sm:grid-cols-2 gap-4">
        {/* Resource Impact */}
        <div>
          <div className={`h-3 w-28 ${shimmer} mb-2`} />
          <div className="space-y-2">
            {[0,1,2].map(i => (
              <div key={i} className="p-3 bg-background/60 rounded-lg border">
                <div className="flex justify-between mb-2">
                  <div className={`h-3.5 w-28 ${shimmer}`} />
                  <div className={`h-3.5 w-14 ${shimmer}`} />
                </div>
                <div className={`h-2 w-full ${shimmerLg}`} />
              </div>
            ))}
          </div>
        </div>
        {/* Community Impact */}
        <div>
          <div className={`h-3 w-32 ${shimmer} mb-2`} />
          <div className="space-y-2">
            {[0,1,2].map(i => (
              <div key={i} className="p-3 bg-background/60 rounded-lg border">
                <div className="flex justify-between mb-2">
                  <div className={`h-3.5 w-32 ${shimmer}`} />
                  <div className={`h-3.5 w-14 ${shimmer}`} />
                </div>
                <div className={`h-2 w-full ${shimmerLg}`} />
              </div>
            ))}
          </div>
        </div>
      </div>
      {/* Summary */}
      <div className="mt-4 p-4 bg-background/60 rounded-lg border space-y-3">
        <div className="flex items-center gap-3">
          <div className={`w-16 h-16 rounded-full ${shimmerLg}`} />
          <div className="flex-1 space-y-2">
            <div className={`h-5 w-20 ${shimmerLg}`} />
            <div className={`h-3 w-full ${shimmer}`} />
            <div className={`h-3 w-5/6 ${shimmer}`} />
          </div>
        </div>
      </div>
    </div>
  )
}

function AlertsSkeleton() {
  return (
    <div className="animate-fade-in-up" style={{ animationDelay: '0.6s', animationFillMode: 'backwards' }}>
      <SkeletonHeader title="Predictions & Alerts" icon={Bell} delay="0.6s" />
      <div className="grid sm:grid-cols-2 gap-3">
        {[0,1,2,3].map(i => (
          <div key={i} className="rounded-xl border bg-card p-4">
            <div className="flex items-start gap-3">
              <div className={`w-10 h-10 ${shimmerLg} shrink-0`} />
              <div className="flex-1 space-y-2">
                <div className="flex items-center gap-2">
                  <div className={`h-4 w-28 ${shimmer}`} />
                  <div className={`h-5 w-16 ${shimmerLg}`} />
                </div>
                <div className={`h-3 w-36 ${shimmer}`} />
                <div className={`h-3 w-full ${shimmer}`} />
                <div className={`h-10 w-full ${shimmerLg}`} />
              </div>
            </div>
          </div>
        ))}
      </div>
    </div>
  )
}

function SuggestionsSkeleton({ delay = '0.7s' }: { delay?: string }) {
  return (
    <div className="rounded-xl border bg-gradient-to-br from-rose-50 to-transparent dark:from-rose-950/20 dark:to-transparent p-4 animate-fade-in-up" style={{ animationDelay: delay, animationFillMode: 'backwards' }}>
      <div className="flex items-center gap-2 mb-4">
        <div className="w-8 h-8 rounded-lg bg-rose-100 dark:bg-rose-900/30 flex items-center justify-center">
          <Lightbulb className="h-4 w-4 text-rose-400" />
        </div>
        <h3 className="text-sm font-semibold text-muted-foreground">Personalized Suggestions</h3>
        <span className="text-xs text-rose-500 animate-pulse ml-1">Generating...</span>
      </div>
      <div className="grid sm:grid-cols-2 gap-3">
        {[0,1,2,3].map(i => (
          <div key={i} className="flex items-start gap-3 p-4 rounded-lg bg-background/60 border">
            <div className="w-8 h-8 rounded-full bg-rose-200 dark:bg-rose-800/40 animate-pulse shrink-0" />
            <div className="flex-1 space-y-2">
              <div className={`h-4 w-28 ${shimmer}`} />
              <div className={`h-3 w-full ${shimmer}`} />
              <div className={`h-3 w-3/4 ${shimmer}`} />
            </div>
          </div>
        ))}
      </div>
    </div>
  )
}

export default function TravelSmartPage() {
  const router = useRouter()
  const [currentStep, setCurrentStep] = useState<Step>('details')
  const [quickGenerate, setQuickGenerate] = useState<boolean>(false)
  const [tripData, setTripData] = useState<TripData>({
    destination: '',
    dateRange: undefined,
    travelers: 2,
    travelerNames: ['', ''],
    travelerGenders: ['', '']
  })
  const [preferences, setPreferences] = useState<Preferences[]>([{
    travelStyle: 'balanced',
    crowdTolerance: 'avoid-crowd',
    seasonType: 'no-preference',
    preferredSeasons: [],
    safetyOptions: {
      avoidLateNight: true,
      preferWellLit: true,
      verifiedTransport: true
    },
    budgetMin: '',
    budgetMax: '',
    notifications: {
      crowd: true,
      weather: true,
      price: true,
      safety: true
    }
  }])
  const [currentTravelerIndex, setCurrentTravelerIndex] = useState<number>(0)
  const [selectedPlan, setSelectedPlan] = useState<string>('Balanced Plan')
  const [streamingMode, setStreamingMode] = useState<'quick' | 'full' | null>(null)
  const [showCompletionBanner, setShowCompletionBanner] = useState(false)
  const [revealedSections, setRevealedSections] = useState<Set<string>>(new Set())
  const [contentVisible, setContentVisible] = useState<Set<string>>(new Set())
  const exitTimersRef = useRef<Map<string, ReturnType<typeof setTimeout>>>(new Map())
  const [showAllPreferences, setShowAllPreferences] = useState<boolean>(false)
  const [destinationSearch, setDestinationSearch] = useState<string>('')
  const [showDestinationDropdown, setShowDestinationDropdown] = useState<boolean>(false)
  const [generatedPlan, setGeneratedPlan] = useState<any>(null)
  const [quickGenerateData, setQuickGenerateData] = useState<any>(null)
  const [showShareSuccess, setShowShareSuccess] = useState<boolean>(false)
  const [sharedPlatform, setSharedPlatform] = useState<string>('')
  const [showSaveDialog, setShowSaveDialog] = useState<boolean>(false)
  const [isSaving, setIsSaving] = useState<boolean>(false)
  const [touchedFields, setTouchedFields] = useState<Set<string>>(new Set())
  const [submitAttempted, setSubmitAttempted] = useState<boolean>(false)
  const [peakOverride, setPeakOverride] = useState<boolean>(false)

  // Shared trip (invite friends) state
  const [sharedTripId, setSharedTripId] = useState<string | null>(null)
  const [creatorParticipantId, setCreatorParticipantId] = useState<string | null>(null)
  const [sharedTripData, setSharedTripData] = useState<any>(null)
  const [isCreatingTrip, setIsCreatingTrip] = useState(false)
  const [linkCopied, setLinkCopied] = useState(false)
  const [scrollProgress, setScrollProgress] = useState(0)

  // Track scroll progress on results step
  useEffect(() => {
    if (currentStep !== 'results') { setScrollProgress(0); return }
    const handleScroll = () => {
      const scrollTop = window.scrollY
      const docHeight = document.documentElement.scrollHeight - window.innerHeight
      setScrollProgress(docHeight > 0 ? Math.min(scrollTop / docHeight, 1) : 0)
    }
    window.addEventListener('scroll', handleScroll, { passive: true })
    handleScroll()
    return () => window.removeEventListener('scroll', handleScroll)
  }, [currentStep])

  // Auto-dismiss completion banner after 4 seconds
  useEffect(() => {
    if (showCompletionBanner) {
      const timer = setTimeout(() => setShowCompletionBanner(false), 4000)
      return () => clearTimeout(timer)
    }
  }, [showCompletionBanner])

  // Skeleton exit → content entrance transition
  // When a section is revealed, wait 300ms (skeleton fades out) then show content
  useEffect(() => {
    // Reset on new generation
    if (revealedSections.size === 0 && contentVisible.size > 0) {
      exitTimersRef.current.forEach(t => clearTimeout(t))
      exitTimersRef.current.clear()
      setContentVisible(new Set())
      return
    }
    revealedSections.forEach(section => {
      if (!contentVisible.has(section) && !exitTimersRef.current.has(section)) {
        const timer = setTimeout(() => {
          setContentVisible(prev => new Set([...prev, section]))
          exitTimersRef.current.delete(section)
        }, 300)
        exitTimersRef.current.set(section, timer)
      }
    })
  }, [revealedSections]) // eslint-disable-line react-hooks/exhaustive-deps

  // Helper: is a section's skeleton currently fading out?
  const isSectionExiting = useCallback(
    (id: string) => revealedSections.has(id) && !contentVisible.has(id),
    [revealedSections, contentVisible]
  )

  // Auto-detect peak/off-peak from selected dates
  const peakDetection = useMemo(() => {
    if (!tripData.dateRange?.from || !tripData.dateRange?.to) return null
    return detectPeakPeriods(tripData.dateRange.from, tripData.dateRange.to)
  }, [tripData.dateRange])

  // Track field blur for on-blur validation
  const markTouched = useCallback((travelerIndex: number, field: string) => {
    setTouchedFields(prev => {
      const next = new Set(prev)
      next.add(`${travelerIndex}-${field}`)
      return next
    })
  }, [])

  const isTouched = useCallback((travelerIndex: number, field: string) => {
    return touchedFields.has(`${travelerIndex}-${field}`)
  }, [touchedFields])

  // Memoized validation
  const validationErrors = useMemo(() => {
    const errors: { travelerIndex: number; field: string }[] = []
    for (let i = 0; i < tripData.travelers; i++) {
      if (!tripData.travelerNames[i]?.trim()) errors.push({ travelerIndex: i, field: 'name' })
      if (!tripData.travelerGenders[i]) errors.push({ travelerIndex: i, field: 'gender' })
      if (!preferences[i]?.budgetMax) errors.push({ travelerIndex: i, field: 'budgetMax' })
      const safety = preferences[i]?.safetyOptions
      if (safety && !safety.avoidLateNight && !safety.preferWellLit && !safety.verifiedTransport) {
        errors.push({ travelerIndex: i, field: 'safety' })
      }
      const notifs = preferences[i]?.notifications
      if (notifs && !notifs.crowd && !notifs.weather && !notifs.price && !notifs.safety) {
        errors.push({ travelerIndex: i, field: 'alerts' })
      }
    }
    return errors
  }, [tripData.travelers, tripData.travelerNames, tripData.travelerGenders, preferences])

  const isPreferencesValid = validationErrors.length === 0
  const hasErrorsForTraveler = useCallback((index: number) => validationErrors.some(e => e.travelerIndex === index), [validationErrors])

  // Show error if field was touched (on blur) OR if submit was attempted
  const shouldShowFieldError = useCallback((travelerIndex: number, field: string) => {
    if (!validationErrors.some(e => e.travelerIndex === travelerIndex && e.field === field)) return false
    return submitAttempted || isTouched(travelerIndex, field)
  }, [validationErrors, submitAttempted, isTouched])

  // Ref for auto-focusing first invalid field on submit
  const nameInputRefs = useRef<Map<number, HTMLInputElement>>(new Map())
  const genderTriggerRefs = useRef<Map<number, HTMLButtonElement>>(new Map())
  const budgetMaxInputRefs = useRef<Map<number, HTMLInputElement>>(new Map())
  const generateAbortRef = useRef<AbortController | null>(null)

  // Sync preferences array with travelers count
  useEffect(() => {
    const defaultPreferences: Preferences = {
      travelStyle: 'balanced',
      crowdTolerance: 'avoid-crowd',
      seasonType: 'no-preference',
      preferredSeasons: [],
      safetyOptions: {
        avoidLateNight: true,
        preferWellLit: true,
        verifiedTransport: true
      },
      budgetMin: '',
      budgetMax: '',
      notifications: {
        crowd: true,
        weather: true,
        price: true,
        safety: true
      }
    }

    const currentPrefs = [...preferences]
    while (currentPrefs.length < tripData.travelers) {
      currentPrefs.push({ ...defaultPreferences })
    }
    while (currentPrefs.length > tripData.travelers) {
      currentPrefs.pop()
    }
    if (currentPrefs.length !== preferences.length) {
      setPreferences(currentPrefs)
    }
    // Ensure currentTravelerIndex is valid
    if (currentTravelerIndex >= tripData.travelers) {
      setCurrentTravelerIndex(Math.max(0, tripData.travelers - 1))
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tripData.travelers])

  // Malaysian destinations list
  const malaysianDestinations = useMemo(() => [
    'Melaka'
  ], [])

  const filteredDestinations = useMemo(() => {
    if (!destinationSearch.trim()) {
      return malaysianDestinations.slice(0, 10) // Show first 10 when no search
    }
    return malaysianDestinations.filter(dest =>
      dest.toLowerCase().includes(destinationSearch.toLowerCase())
    )
  }, [destinationSearch, malaysianDestinations])

  // Get minimal fallback alerts (only used if AI completely fails)
  const getMinimalFallbackAlerts = () => {
    return {
      crowd: [
        { title: 'Crowd Forecast', location: tripData.destination || 'Destination', time: 'Check dates', level: 'MEDIUM', levelType: 'warning', description: 'Please wait for AI-generated predictions.', suggestion: 'AI predictions loading...' }
      ],
      weather: [
        { title: 'Weather Alert', location: tripData.destination || 'Destination', time: 'Check dates', level: 'INFO', levelType: 'info', description: 'Weather predictions will be generated.', suggestion: 'AI predictions loading...' }
      ],
      price: [
        { title: 'Price Alert', location: tripData.destination || 'Destination', time: 'Check dates', level: 'INFO', levelType: 'info', description: 'Price predictions will be generated.', suggestion: 'AI predictions loading...' }
      ],
      safety: [
        { title: 'Safety Notice', location: tripData.destination || 'Destination', time: 'All times', level: 'INFO', levelType: 'info', description: 'Safety recommendations will be personalized.', suggestion: 'AI predictions loading...' }
      ]
    }
  }

  // Get minimal fallback suggestions
  const getMinimalFallbackSuggestions = () => {
    return [
      { title: 'Plan Ahead', description: 'AI-generated suggestions will appear here based on your preferences.' },
      { title: 'Stay Flexible', description: 'Keep some buffer time for unexpected discoveries.' },
      { title: 'Local Tips', description: 'Explore local recommendations for authentic experiences.' },
      { title: 'Book Smart', description: 'Reserve popular attractions and accommodations in advance.' }
    ]
  }

  // Get minimal fallback analytics (only used if AI completely fails)
  const getMinimalFallbackAnalytics = () => {
    return {
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
    }
  }

  // Get minimal fallback sustainability (only used if AI completely fails)
  const getMinimalFallbackSustainability = () => {
    return {
      waterUsage: { value: 50, level: 'Medium' },
      wasteGeneration: { value: 35, level: 'Low' },
      energyConsumption: { value: 45, level: 'Medium' },
      localBusinessSupport: 'Medium',
      infrastructurePressure: 'Medium',
      culturalPreservation: 'Positive',
      overallScore: 65,
      overallLabel: 'Moderate',
      summary: 'This plan has a moderate sustainability profile. Water usage and energy consumption are at average levels due to standard accommodations. Waste generation is kept low through local dining choices. Consider visiting during off-peak periods for a lower environmental footprint.',
      carbonFootprint: {
        level: 'Medium',
        estimate: '45 kg CO2 per person',
        comparison: '10% lower than average tourist'
      },
      travelDateAssessment: {
        currentDates: {
          suitability: 'Moderate',
          reason: 'Average tourist activity during this period'
        },
        recommendedDates: {
          period: 'Off-peak season months',
          reason: 'Lower crowds and reduced environmental impact'
        },
        peakSeasons: ['School holidays', 'Public holiday weekends'],
        level: 'Medium'
      },
      recommendations: [
        { tip: 'Use public transport to reduce carbon footprint', impact: 'High', category: 'Transport' },
        { tip: 'Support local businesses and street vendors', impact: 'High', category: 'Food' },
        { tip: 'Carry reusable bottles to minimize waste', impact: 'Medium', category: 'Waste' },
        { tip: 'Visit popular sites during off-peak hours', impact: 'Medium', category: 'Activity' },
        { tip: 'Choose eco-friendly accommodations when possible', impact: 'High', category: 'Accommodation' },
        { tip: 'Reduce single-use plastics during your trip', impact: 'Low', category: 'Waste' }
      ]
    }
  }

  // Use OpenAI-generated data if available, otherwise minimal fallback
  // Section data is now at top-level keys, keyed by plan name (section-based streaming structure)
  const aiAlerts = generatedPlan?.alerts?.[selectedPlan]
  const alerts = aiAlerts || getMinimalFallbackAlerts()

  const aiSuggestions = generatedPlan?.suggestions?.[selectedPlan]
  const suggestions = aiSuggestions || getMinimalFallbackSuggestions()

  const aiAnalytics = generatedPlan?.analytics?.[selectedPlan]
  const analytics = aiAnalytics || getMinimalFallbackAnalytics()

  const aiSustainability = generatedPlan?.sustainability?.[selectedPlan]
  const sustainability = aiSustainability || getMinimalFallbackSustainability()

  const aiBestWindow = generatedPlan?.bestWindow?.[selectedPlan]


  const handleDetailsSubmit = () => {
    if (tripData.destination && tripData.dateRange?.from && tripData.dateRange?.to) {
      // Auto-set seasonType and preferredSeasons from date detection + override
      if (peakDetection) {
        const effectiveSeasonType = peakOverride ? 'off-peak' : peakDetection.seasonType
        const effectiveSeasons = peakOverride ? [] : peakDetection.overlappingPeriods.map(op => op.name)
        const newPrefs = preferences.map(p => ({
          ...p,
          seasonType: effectiveSeasonType,
          preferredSeasons: effectiveSeasons,
        }))
        setPreferences(newPrefs)
      }

      if (quickGenerate) {
        // Skip preferences, go directly to generation
        handleGeneratePlan(true)
      } else {
        setCurrentStep('preferences')
      }
    }
  }


  const handleGeneratePlan = async (isQuickGenerate: boolean = false) => {
    // Cancel any previous request (silently — don't let its catch reset our new state)
    generateAbortRef.current?.abort()
    const abortController = new AbortController()
    generateAbortRef.current = abortController

    // Clear old data and revealed sections so all skeletons show
    setGeneratedPlan(null)
    setQuickGenerateData(null)
    setRevealedSections(new Set())

    // Navigate to results immediately with skeleton loading
    setStreamingMode(isQuickGenerate ? 'quick' : 'full')
    setShowCompletionBanner(false)
    setCurrentStep('results')
    window.scrollTo({ top: 0, behavior: 'smooth' })

    try {
      if (isQuickGenerate) {
        const quickRequestData = {
          destination: tripData.destination,
          start_date: tripData.dateRange?.from ? tripData.dateRange.from.toISOString().split('T')[0] : '',
          end_date: tripData.dateRange?.to ? tripData.dateRange.to.toISOString().split('T')[0] : '',
          travelers: tripData.travelers
        }

        const response = await fetch('/api/quick-generate', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(quickRequestData),
          signal: abortController.signal
        })

        if (!response.ok) {
          const errorData = await response.json().catch(() => ({ error: 'Unknown error' }))
          throw new Error(errorData.error || `HTTP ${response.status}: Failed to generate quick prediction`)
        }

        const quickData = await readStreamedJSON(response, undefined, 3000, (partial) => {
          if (generateAbortRef.current !== abortController) return
          const sections = detectQuickSections(partial)
          if (sections.size > 0) {
            setRevealedSections(prev => {
              const next = new Set(prev)
              sections.forEach(s => next.add(s))
              return next
            })
            setQuickGenerateData(partial)
          }
        })
        setQuickGenerateData(quickData)
        setGeneratedPlan(null)
        setRevealedSections(new Set(['q-overview', 'q-analytics', 'q-tips']))
        setStreamingMode(null)
        setShowCompletionBanner(true)
      } else {
        const travelersData = tripData.travelerNames.map((name, index) => ({
          name: name || `Traveler ${index + 1}`,
          gender: tripData.travelerGenders[index] || '',
          preferences: preferences[index] || preferences[0]
        }))

        const requestData = {
          group_id: `group-${tripData.travelers}`,
          trip_details: {
            destination: tripData.destination,
            start_date: tripData.dateRange?.from ? tripData.dateRange.from.toISOString().split('T')[0] : '',
            end_date: tripData.dateRange?.to ? tripData.dateRange.to.toISOString().split('T')[0] : ''
          },
          travelers: travelersData
        }

        const response = await fetch('/api/generate-plan', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(requestData),
          signal: abortController.signal
        })

        if (!response.ok) {
          const errorData = await response.json().catch(() => ({ error: 'Unknown error' }))
          throw new Error(errorData.error || `HTTP ${response.status}: Failed to generate travel plan`)
        }

        // Real progressive reveal: detect sections as they stream in
        let planSelected = false

        const planData = await readStreamedJSON(response, undefined, 12000, (partial) => {
          if (generateAbortRef.current !== abortController) return
          const sections = detectStreamSections(partial)
          if (sections.size > 0) {
            setRevealedSections(prev => {
              const next = new Set(prev)
              sections.forEach(s => next.add(s))
              return next
            })
            setGeneratedPlan(partial)
            // Select first plan for display once plans are ready
            if (!planSelected && sections.has('f-plans')) {
              setSelectedPlan(Object.keys(partial.plans)[0])
              planSelected = true
            }
          }
        })

        // Stream complete — set final data, select recommended plan
        setGeneratedPlan(planData)
        setQuickGenerateData(null)
        setRevealedSections(new Set(['f-plans', 'f-details', 'f-window', 'f-analytics', 'f-sustainability', 'f-alerts', 'f-suggestions']))
        const planNames = Object.keys(planData.plans || {})
        if (planNames.length > 1) setSelectedPlan(planNames[1])
        setStreamingMode(null)
        setShowCompletionBanner(true)
      }

    } catch (error) {
      // Only reset state if this is still the active request (not superseded by a new one)
      if (generateAbortRef.current !== abortController) return
      if (error instanceof DOMException && error.name === 'AbortError') {
        setStreamingMode(null)
        return
      }
      setStreamingMode(null)
      alert(`Failed to generate travel plan: ${error instanceof Error ? error.message : 'Unknown error'}`)
    }
  }

  const handlePreferencesSubmit = () => {
    if (!isPreferencesValid) {
      setSubmitAttempted(true)
      // Auto-navigate to first traveler with errors and focus first invalid field
      const firstError = validationErrors[0]
      if (firstError) {
        setCurrentTravelerIndex(firstError.travelerIndex)
        // Focus after React re-renders the tab
        setTimeout(() => {
          if (firstError.field === 'name') {
            nameInputRefs.current.get(firstError.travelerIndex)?.focus()
          } else if (firstError.field === 'gender') {
            genderTriggerRefs.current.get(firstError.travelerIndex)?.focus()
          } else if (firstError.field === 'budgetMax') {
            budgetMaxInputRefs.current.get(firstError.travelerIndex)?.focus()
          }
        }, 50)
      }
      return
    }
    handleGeneratePlan(false)
  }

  const handleSavePlan = async () => {
    setIsSaving(true)
    try {
      const travelersData = tripData.travelerNames.map((name, index) => ({
        name: name || `Traveler ${index + 1}`,
        gender: tripData.travelerGenders[index] || '',
        preferences: preferences[index] || preferences[0]
      }))

      const response = await fetch('/api/save-plan', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          group_id: `group-${tripData.travelers}`,
          trip_details: {
            destination: tripData.destination,
            start_date: tripData.dateRange?.from ? tripData.dateRange.from.toISOString().split('T')[0] : '',
            end_date: tripData.dateRange?.to ? tripData.dateRange.to.toISOString().split('T')[0] : ''
          },
          travelers: travelersData,
          selected_plan: selectedPlan,
          generated_plan: generatedPlan || quickGenerateData
        })
      })

      const result = await response.json()

      if (!result.success) {
        throw new Error(result.error || 'Failed to save plan')
      }

      setShowSaveDialog(false)
      router.push('/dashboard')
    } catch (error) {
      alert(`Failed to save plan: ${error instanceof Error ? error.message : 'Unknown error'}`)
    } finally {
      setIsSaving(false)
    }
  }

  const handleSelectPlan = (plan: string) => {
    setSelectedPlan(plan)
  }

  // Check if a traveler tab is a friend who submitted via shared trip (read-only)
  const isFriendSubmitted = useCallback((travelerIndex: number) => {
    if (!sharedTripData || travelerIndex === 0) return false
    const participant = sharedTripData.participants?.[travelerIndex]
    if (!participant) return false
    return participant.submittedAt !== null && participant.preferences !== null
  }, [sharedTripData])

  // Sync friends' submitted preferences from shared trip into local state
  useEffect(() => {
    if (!sharedTripData?.participants) return
    const participants = sharedTripData.participants as Array<{
      name: string
      gender: string
      submittedAt: string | null
      preferences: any
    }>

    let needsUpdate = false
    const newNames = [...tripData.travelerNames]
    const newGenders = [...tripData.travelerGenders]
    const newPrefs = [...preferences]

    // Only sync friends (index 1+), leave creator (index 0) alone
    for (let i = 1; i < participants.length; i++) {
      const p = participants[i]
      if (p.submittedAt && p.preferences) {
        if (newNames[i] !== p.name || newPrefs[i] !== p.preferences) {
          newNames[i] = p.name
          newGenders[i] = p.gender || ''
          newPrefs[i] = p.preferences
          needsUpdate = true
        }
      }
    }

    if (needsUpdate) {
      setTripData(prev => ({ ...prev, travelerNames: newNames, travelerGenders: newGenders }))
      setPreferences(newPrefs)
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [sharedTripData])

  // Sync local traveler count to shared trip when creator adds/removes travelers
  useEffect(() => {
    if (!sharedTripId) return
    if (!sharedTripData || sharedTripData.tripDetails?.totalTravelers === tripData.travelers) return
    fetch(`/api/trips/${sharedTripId}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ totalTravelers: tripData.travelers }),
    })
      .then(res => res.ok ? res.json() : null)
      .then(data => { if (data) setSharedTripData(data) })
      .catch(() => {})
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tripData.travelers, sharedTripId])

  const defaultSharedPrefs = {
    travelStyle: 'balanced',
    crowdTolerance: 'avoid-crowd',
    seasonType: 'no-preference',
    preferredSeasons: [],
    safetyOptions: { avoidLateNight: true, preferWellLit: true, verifiedTransport: true },
    budgetMin: '',
    budgetMax: '5000',
    notifications: { crowd: true, weather: true, price: true, safety: true },
  }

  // Invite Friends: create shared trip
  const handleInviteFriends = async () => {
    if (!tripData.destination || !tripData.dateRange?.from || !tripData.dateRange?.to) return
    setIsCreatingTrip(true)

    try {
      const response = await fetch('/api/trips', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          creatorName: tripData.travelerNames[0] || 'Trip Creator',
          destination: tripData.destination,
          startDate: tripData.dateRange.from.toISOString().split('T')[0],
          endDate: tripData.dateRange.to.toISOString().split('T')[0],
          totalTravelers: tripData.travelers,
          seasonContext: peakDetection ? {
            seasonType: peakOverride ? 'off-peak' : peakDetection.seasonType,
            preferredSeasons: peakOverride ? [] : peakDetection.overlappingPeriods.map(op => op.name),
            peakOverride,
          } : undefined,
        }),
      })

      if (!response.ok) throw new Error('Failed to create shared trip')

      const data = await response.json()
      setSharedTripId(data.tripId)
      setCreatorParticipantId(data.creatorParticipantId)

      // Fetch the full trip data
      const tripResponse = await fetch(`/api/trips/${data.tripId}`)
      if (tripResponse.ok) {
        setSharedTripData(await tripResponse.json())
      }

    } catch (error) {
      alert(`Failed to create shared trip: ${error instanceof Error ? error.message : 'Unknown error'}`)
    } finally {
      setIsCreatingTrip(false)
    }
  }

  // Refresh shared trip status
  const refreshTripStatus = async () => {
    if (!sharedTripId) return
    try {
      const response = await fetch(`/api/trips/${sharedTripId}`)
      if (response.ok) {
        setSharedTripData(await response.json())
      }
    } catch {
      // silently fail
    }
  }

  // Generate plan with shared preferences — calls API directly to avoid React state timing issues
  const handleGenerateWithSharedPreferences = async () => {
    if (!sharedTripData) return

    const participants = sharedTripData.participants as Array<{
      name: string
      gender: string
      preferences: any
    }>

    // Creator is participants[0] — use their local preferences or defaults
    // Friends are participants[1+] — use their submitted preferences
    const names = participants.map(p => p.name)
    const genders = participants.map(p => p.gender || '')
    const prefs = participants.map((p, i) =>
      i === 0 ? (preferences[0] || defaultSharedPrefs) : (p.preferences || defaultSharedPrefs)
    )

    // Update local state for the results view
    setTripData(prev => ({
      ...prev,
      travelers: participants.length,
      travelerNames: names,
      travelerGenders: genders,
    }))
    setPreferences(prefs)

    // Build request directly from shared data (don't rely on React state)
    generateAbortRef.current?.abort()
    const abortController = new AbortController()
    generateAbortRef.current = abortController

    // Clear old data and revealed sections so all skeletons show
    setGeneratedPlan(null)
    setQuickGenerateData(null)
    setRevealedSections(new Set())

    // Navigate to results immediately with skeleton loading
    setStreamingMode('full')
    setShowCompletionBanner(false)
    setCurrentStep('results')
    window.scrollTo({ top: 0, behavior: 'smooth' })

    try {
      const travelersData = names.map((name, index) => ({
        name: name || `Traveler ${index + 1}`,
        gender: genders[index] || '',
        preferences: prefs[index] || defaultSharedPrefs,
      }))

      const requestData = {
        group_id: `group-${participants.length}`,
        trip_details: {
          destination: sharedTripData.tripDetails.destination,
          start_date: sharedTripData.tripDetails.startDate,
          end_date: sharedTripData.tripDetails.endDate,
        },
        travelers: travelersData,
      }

      const response = await fetch('/api/generate-plan', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(requestData),
        signal: abortController.signal,
      })

      if (!response.ok) {
        const errorData = await response.json().catch(() => ({ error: 'Unknown error' }))
        throw new Error(errorData.error || `HTTP ${response.status}: Failed to generate plan`)
      }

      // Real progressive reveal: detect sections as they stream in
      let planSelected = false

      const planData = await readStreamedJSON(response, undefined, 12000, (partial) => {
        if (generateAbortRef.current !== abortController) return
        const sections = detectStreamSections(partial)
        if (sections.size > 0) {
          setRevealedSections(prev => {
            const next = new Set(prev)
            sections.forEach(s => next.add(s))
            return next
          })
          setGeneratedPlan(partial)
          if (!planSelected && sections.has('f-plans')) {
            setSelectedPlan(Object.keys(partial.plans)[0])
            planSelected = true
          }
        }
      })

      setGeneratedPlan(planData)
      setQuickGenerateData(null)
      setRevealedSections(new Set(['f-plans', 'f-details', 'f-window', 'f-analytics', 'f-sustainability', 'f-alerts', 'f-suggestions']))
      const planNames = Object.keys(planData.plans || {})
      if (planNames.length > 1) setSelectedPlan(planNames[1])
      setStreamingMode(null)
      setShowCompletionBanner(true)
    } catch (error) {
      if (generateAbortRef.current !== abortController) return
      if (error instanceof DOMException && error.name === 'AbortError') {
        setStreamingMode(null)
        return
      }
      setStreamingMode(null)
      alert(`Failed to generate travel plan: ${error instanceof Error ? error.message : 'Unknown error'}`)
    }
  }

  // Clear shared trip state on page load (fresh start)
  useEffect(() => {
    sessionStorage.removeItem('sharedTripId')
    sessionStorage.removeItem('creatorParticipantId')
  }, [])

  // Initialize selectedPlan when generatedPlan is loaded (skip during streaming — handled on completion)
  useEffect(() => {
    if (streamingMode !== null) return
    if (generatedPlan?.plans && Object.keys(generatedPlan.plans).length > 0) {
      const planNames = Object.keys(generatedPlan.plans);
      if (!generatedPlan.plans[selectedPlan]) {
        const defaultPlan = planNames.length > 1 ? planNames[1] : planNames[0];
        setSelectedPlan(defaultPlan);
      }
    }
  }, [generatedPlan?.plans, selectedPlan, streamingMode])

  const formatDate = (date: Date | string | undefined) => {
    try {
      if (!date) return ''
      const dateObj = typeof date === 'string' ? new Date(date) : date
      if (!(dateObj instanceof Date) || isNaN(dateObj.getTime())) return ''
      const day = dateObj.getDate()
      const months = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec']
      const month = months[dateObj.getMonth()]
      const year = dateObj.getFullYear()
      return `${day} ${month} ${year}`
    } catch {
      return ''
    }
  }

  const formatDateRange = (dateRange: DateRange | undefined) => {
    try {
    if (!dateRange?.from) return ''
    if (!dateRange.to) return formatDate(dateRange.from)
    return `${formatDate(dateRange.from)} to ${formatDate(dateRange.to)}`
    } catch {
      return ''
    }
  }

  // Get minimal fallback best window
  const getMinimalFallbackBestWindow = () => {
    try {
      const startDate = tripData.dateRange?.from ? formatDate(tripData.dateRange.from) : 'TBD'
      const endDate = tripData.dateRange?.to ? formatDate(tripData.dateRange.to) : 'TBD'
      return {
        optimalPeriod: `${startDate} to ${endDate}`,
        priceAdvantage: '10-15% lower',
        crowdLevel: 'Medium (50-65%)',
        description: 'AI-generated optimal travel window will appear here'
      }
    } catch {
      return {
        optimalPeriod: 'TBD to TBD',
        priceAdvantage: '10-15% lower',
        crowdLevel: 'Medium (50-65%)',
        description: 'AI-generated optimal travel window will appear here'
      }
    }
  }

  // Format optimalPeriod string (handles "2026-01-30 to 2026-01-30" -> "30 Jan 2026 to 30 Jan 2026")
  const formatOptimalPeriod = (period: string | undefined) => {
    if (!period) return 'TBD to TBD'
    // Check if it contains ISO date format (YYYY-MM-DD)
    const isoDatePattern = /(\d{4}-\d{2}-\d{2})/g
    const matches = period.match(isoDatePattern)
    if (matches && matches.length > 0) {
      let formatted = period
      matches.forEach(isoDate => {
        formatted = formatted.replace(isoDate, formatDate(isoDate))
      })
      return formatted
    }
    return period
  }

  // Match traveler preferences to plan characteristics with scoring
  const getTravelerPreferenceMatch = (planData: any, planName: string) => {
    const matches: { name: string; prefers: boolean; score: number; reasons: { text: string; positive: boolean }[] }[] = []

    const crowdText = (planData?.crowdLevel || 'Medium').toLowerCase()
    const isLowCrowd = crowdText.includes('low')
    const isHighCrowd = crowdText.includes('high')
    const isMediumCrowd = !isLowCrowd && !isHighCrowd

    // Parse plan price
    const priceStr = planData?.pricePerPerson?.replace(/[^0-9]/g, '') || '1000'
    const planPrice = parseInt(priceStr) || 1000

    // Analyze plan name and description for characteristics
    const planNameLower = planName.toLowerCase()
    const descLower = (planData?.description || '').toLowerCase()
    const keyFeatures = (planData?.keyFeatures || []).join(' ').toLowerCase()
    const benefits = (planData?.benefits || []).join(' ').toLowerCase()
    const allPlanText = `${planNameLower} ${descLower} ${keyFeatures} ${benefits}`

    // Detect plan characteristics from text
    const isBudgetPlan = allPlanText.includes('budget') || allPlanText.includes('value') || allPlanText.includes('saver') || allPlanText.includes('affordable')
    const isComfortPlan = allPlanText.includes('comfort') || allPlanText.includes('premium') || allPlanText.includes('luxury') || allPlanText.includes('serenity')
    const isBalancedPlan = allPlanText.includes('balance') || allPlanText.includes('blend') || allPlanText.includes('adventure')
    const hasSafetyFeatures = allPlanText.includes('safe') || allPlanText.includes('secure') || allPlanText.includes('verified') || allPlanText.includes('well-lit')
    const hasEarlyHours = allPlanText.includes('early') || allPlanText.includes('morning') || allPlanText.includes('9 am') || allPlanText.includes('avoid peak')
    const hasPeacefulSpots = allPlanText.includes('peaceful') || allPlanText.includes('quiet') || allPlanText.includes('relaxed') || allPlanText.includes('serene')

    tripData.travelerNames.forEach((name, idx) => {
      const pref = preferences[idx] || preferences[0]
      const travelerName = name || `Traveler ${idx + 1}`
      let score = 0
      const maxScore = 100
      const reasons: { text: string; positive: boolean }[] = []

      // 1. CROWD TOLERANCE (30 points max)
      if (pref.crowdTolerance === 'avoid-crowd') {
        if (isLowCrowd) {
          score += 30
          reasons.push({ text: 'Low crowd', positive: true })
        } else if (isMediumCrowd) {
          score += 15
          reasons.push({ text: 'Medium crowd', positive: true })
        } else {
          score -= 10
          reasons.push({ text: 'High crowd', positive: false })
        }
      } else if (pref.crowdTolerance === 'okay-crowd') {
        if (!isHighCrowd) {
          score += 25
        } else {
          score += 15
          reasons.push({ text: 'Crowded but OK', positive: true })
        }
      } else {
        score += 20 // 'any' tolerance
      }

      // 2. BUDGET (25 points max)
      const budgetMin = parseFloat(pref.budgetMin?.replace(/[^0-9]/g, '') || '0')
      const budgetMax = parseFloat(pref.budgetMax?.replace(/[^0-9]/g, '') || '0')
      if (budgetMax > 0) {
        if (planPrice <= budgetMax && planPrice >= budgetMin) {
          score += 25
          reasons.push({ text: 'Within budget', positive: true })
        } else if (planPrice <= budgetMax * 1.1) {
          score += 15
          reasons.push({ text: 'Near budget', positive: true })
        } else {
          score -= 15
          reasons.push({ text: 'Over budget', positive: false })
        }
      } else {
        score += 15 // No budget set, neutral
      }

      // 3. TRAVEL STYLE (25 points max)
      if (pref.travelStyle === 'low-budget') {
        if (isBudgetPlan) {
          score += 25
          reasons.push({ text: 'Budget friendly', positive: true })
        } else if (isBalancedPlan) {
          score += 15
        } else {
          score += 5
          reasons.push({ text: 'Premium style', positive: false })
        }
      } else if (pref.travelStyle === 'comfortable') {
        if (isComfortPlan || hasPeacefulSpots) {
          score += 25
          reasons.push({ text: 'Comfort match', positive: true })
        } else if (isBalancedPlan) {
          score += 15
        } else {
          score += 10
        }
      } else { // balanced
        if (isBalancedPlan) {
          score += 25
          reasons.push({ text: 'Balanced choice', positive: true })
        } else {
          score += 18
        }
      }

      // 4. SAFETY PREFERENCES (20 points max)
      let safetyScore = 0
      let safetyMatches = 0
      let safetyTotal = 0

      if (pref.safetyOptions.avoidLateNight) {
        safetyTotal++
        if (hasEarlyHours || hasPeacefulSpots) {
          safetyMatches++
        }
      }
      if (pref.safetyOptions.preferWellLit) {
        safetyTotal++
        if (hasSafetyFeatures) {
          safetyMatches++
        }
      }
      if (pref.safetyOptions.verifiedTransport) {
        safetyTotal++
        if (hasSafetyFeatures) {
          safetyMatches++
        }
      }

      if (safetyTotal > 0) {
        safetyScore = Math.round((safetyMatches / safetyTotal) * 20)
        if (safetyMatches === safetyTotal && safetyTotal > 0) {
          reasons.push({ text: 'Safety match', positive: true })
        } else if (safetyMatches === 0 && safetyTotal > 1) {
          reasons.push({ text: 'Safety concerns', positive: false })
        }
      } else {
        safetyScore = 15 // No safety preferences set
      }
      score += safetyScore

      // Calculate final score percentage
      const finalScore = Math.min(Math.max(Math.round((score / maxScore) * 100), 0), 100)
      const prefers = finalScore >= 60

      // If no specific reasons, add a general one
      if (reasons.length === 0) {
        reasons.push({ text: prefers ? 'Good fit' : 'Less ideal', positive: prefers })
      }

      matches.push({
        name: travelerName,
        prefers,
        score: finalScore,
        reasons
      })
    })

    return matches
  }

  // Compute bestWindow after formatDate is defined
  const bestWindow = useMemo(() => {
    if (aiBestWindow) {
      return {
        ...aiBestWindow,
        optimalPeriod: formatOptimalPeriod(aiBestWindow.optimalPeriod)
      }
    }
    return getMinimalFallbackBestWindow()
  }, [aiBestWindow, tripData.dateRange])

  return (
    <PageLayout showFlowGuide={false} maxWidth="lg" background="minimal" className="font-sans theme-rose">
      {/* Completion Banner with Confetti */}
      {showCompletionBanner && (
        <div className="fixed bottom-20 left-1/2 -translate-x-1/2 z-50 animate-in slide-in-from-bottom fade-in duration-300">
          {/* Confetti particles around the container edges */}
          <div className="absolute -inset-2 pointer-events-none overflow-visible">
            {Array.from({ length: 30 }).map((_, i) => {
              // Place particles along the perimeter of the pill
              const t = i / 30
              // Pill perimeter: top edge, right cap, bottom edge, left cap
              let startX: number, startY: number
              if (t < 0.3) {
                // Top edge
                startX = 10 + (t / 0.3) * 80
                startY = 0
              } else if (t < 0.45) {
                // Right side
                startX = 90 + Math.random() * 10
                startY = ((t - 0.3) / 0.15) * 100
              } else if (t < 0.75) {
                // Bottom edge
                startX = 90 - ((t - 0.45) / 0.3) * 80
                startY = 100
              } else {
                // Left side
                startX = Math.random() * 10
                startY = 100 - ((t - 0.75) / 0.25) * 100
              }
              // Fly outward from edge
              const cx = 50, cy = 50
              const dx = startX - cx, dy = startY - cy
              const outDist = 40 + Math.random() * 50
              const tx = (dx / 50) * outDist
              const ty = (dy / 50) * outDist - 15
              const colors = ['#f43f5e', '#10b981', '#3b82f6', '#f59e0b', '#8b5cf6', '#ec4899']
              const color = colors[i % colors.length]
              const size = 3 + Math.random() * 5
              const shapes = ['rounded-full', 'rounded-sm']
              const shape = shapes[i % shapes.length]
              const delay = Math.random() * 0.3
              return (
                <div
                  key={i}
                  className={`absolute ${shape} animate-confetti-explode`}
                  style={{
                    width: size,
                    height: i % 3 === 0 ? size * 1.5 : size,
                    backgroundColor: color,
                    left: `${startX}%`,
                    top: `${startY}%`,
                    // @ts-expect-error CSS custom properties
                    '--tx': `${tx}px`,
                    '--ty': `${ty}px`,
                    animationDelay: `${delay}s`,
                  }}
                />
              )
            })}
          </div>
          <div className="relative flex items-center gap-2 px-5 py-3 rounded-full bg-gradient-to-r from-emerald-500 to-emerald-600 text-white shadow-lg shadow-emerald-500/25 animate-scale-up">
            <div className="flex items-center justify-center w-5 h-5 rounded-full bg-white/20">
              <CheckCircle2 className="h-3.5 w-3.5" />
            </div>
            <span className="text-sm font-semibold">Your plan is ready!</span>
            <Sparkles className="h-3.5 w-3.5 text-emerald-200 animate-pulse" />
          </div>
        </div>
      )}

      <div className="transition-all duration-300">
        {/* STEP 1: Trip Details */}
        {currentStep === 'details' && (
          <div className="space-y-6 max-w-3xl mx-auto">
            {/* Hero Section */}
            <div className="text-center space-y-4">
              <div className="flex justify-center animate-bounce-in">
                <div className="w-16 h-16 rounded-2xl bg-gradient-to-br from-rose-500 to-rose-600 flex items-center justify-center shadow-lg shadow-rose-500/25 animate-float-bounce">
                  <Wand2 className="h-8 w-8 text-white" />
                </div>
              </div>
              <div className="space-y-2 animate-slide-up-fade" style={{ animationDelay: '0.1s', animationFillMode: 'backwards' }}>
                <h2 className="text-2xl font-bold text-foreground">Plan Your Trip</h2>
                <p className="text-sm text-muted-foreground max-w-md mx-auto">
                  Enter your destination, travel dates, and group size to get started.
                  We'll create a personalized itinerary based on your preferences.
                </p>
              </div>
            </div>

            {/* Trip Details Form */}
            <Card className="shadow-md animate-slide-up-fade" style={{ animationDelay: '0.2s', animationFillMode: 'backwards' }}>
              <CardContent className="p-6">
                <div className="space-y-6">
                  {/* Row 1: Destination */}
                  <div className="space-y-2">
                    <Label htmlFor="destination" className="text-sm font-medium flex items-center gap-2">
                      <MapPinIcon className="h-4 w-4 text-rose-500" />
                      Where do you want to go?
                    </Label>
                    <div className="relative">
                      <Input
                        id="destination"
                        placeholder="Search Malaysian destinations..."
                        value={tripData.destination}
                        autoComplete="off"
                        onChange={(e) => {
                          const value = e.target.value
                          setTripData({ ...tripData, destination: value })
                          setDestinationSearch(value)
                          const filtered = malaysianDestinations.filter(dest =>
                            dest.toLowerCase().includes(value.toLowerCase())
                          )
                          setShowDestinationDropdown(value.length > 0 && filtered.length > 0)
                        }}
                        onFocus={() => {
                          setDestinationSearch(tripData.destination)
                          setShowDestinationDropdown(true)
                        }}
                        onBlur={() => setTimeout(() => setShowDestinationDropdown(false), 200)}
                        className="h-11 pr-10"
                      />
                      {tripData.destination && (
                        <Button
                          type="button"
                          variant="ghost"
                          size="icon"
                          className="absolute right-1 top-1 h-9 w-9"
                          onClick={() => {
                            setTripData({ ...tripData, destination: '' })
                            setDestinationSearch('')
                            setShowDestinationDropdown(false)
                          }}
                        >
                          <X className="h-4 w-4" />
                        </Button>
                      )}
                      {showDestinationDropdown && filteredDestinations.length > 0 && (
                        <div className="absolute z-50 w-full mt-1 bg-popover border rounded-md shadow-lg font-[family-name:var(--font-geist-sans)]">
                          <div className="p-1">
                            {filteredDestinations.map((destination) => (
                              <div
                                key={destination}
                                className="flex items-center gap-2 px-3 py-2 text-sm rounded-md hover:bg-muted cursor-pointer"
                                onMouseDown={(e) => {
                                  e.preventDefault()
                                  setTripData({ ...tripData, destination })
                                  setDestinationSearch('')
                                  setShowDestinationDropdown(false)
                                }}
                              >
                                <MapPinIcon className="h-4 w-4 text-primary" />
                                <span>{destination}</span>
                              </div>
                            ))}
                          </div>
                        </div>
                      )}
                    </div>
                  </div>

                  {/* Row 2: Travel Dates and Travelers */}
                  <div className="grid sm:grid-cols-2 gap-4">
                    {/* Travel Dates */}
                    <div className="space-y-2">
                      <Label className="text-sm font-medium flex items-center gap-2">
                        <Calendar className="h-4 w-4 text-rose-500" />
                        When are you traveling?
                      </Label>
                      <DatePicker
                        dateRange={tripData.dateRange}
                        onSelect={(dateRange) => setTripData({ ...tripData, dateRange })}
                        placeholder="Select travel dates"
                      />
                    </div>

                    {/* Travelers */}
                    <div className="space-y-2">
                      <Label htmlFor="travelers" className="text-sm font-medium flex items-center gap-2">
                        <Users className="h-4 w-4 text-rose-500" />
                        How many travelers?
                      </Label>
                      <div className="flex items-center h-11 border border-border rounded-md overflow-hidden">
                        <Button
                          type="button"
                          variant="ghost"
                          size="icon"
                          className="h-full w-11 rounded-none border-r shrink-0"
                          onClick={() => {
                            const newCount = Math.max(1, tripData.travelers - 1)
                            const updatedNames = [...tripData.travelerNames].slice(0, newCount)
                            const updatedGenders = [...tripData.travelerGenders].slice(0, newCount)
                            while (updatedNames.length < newCount) updatedNames.push('')
                            while (updatedGenders.length < newCount) updatedGenders.push('')
                            setTripData({ ...tripData, travelers: newCount, travelerNames: updatedNames, travelerGenders: updatedGenders })
                            if (currentTravelerIndex >= newCount) setCurrentTravelerIndex(Math.max(0, newCount - 1))
                          }}
                        >
                          -
                        </Button>
                        <div className="flex-1 flex items-center justify-center gap-1.5 px-2">
                          <input
                            id="travelers"
                            type="number"
                            min="1"
                            max="50"
                            value={tripData.travelers}
                            onChange={(e) => {
                              const value = parseInt(e.target.value) || 1
                              const newCount = Math.max(1, Math.min(50, value))
                              const updatedNames = [...tripData.travelerNames]
                              const updatedGenders = [...tripData.travelerGenders]
                              while (updatedNames.length < newCount) updatedNames.push('')
                              while (updatedGenders.length < newCount) updatedGenders.push('')
                              while (updatedNames.length > newCount) updatedNames.pop()
                              while (updatedGenders.length > newCount) updatedGenders.pop()
                              setTripData({ ...tripData, travelers: newCount, travelerNames: updatedNames, travelerGenders: updatedGenders })
                              if (currentTravelerIndex >= newCount) setCurrentTravelerIndex(Math.max(0, newCount - 1))
                            }}
                            className="w-12 text-center text-sm font-medium bg-transparent border-none outline-none focus:ring-0 [appearance:textfield] [&::-webkit-outer-spin-button]:appearance-none [&::-webkit-inner-spin-button]:appearance-none"
                          />
                          <span className="text-sm text-muted-foreground">
                            {tripData.travelers === 1 ? 'person' : 'people'}
                          </span>
                        </div>
                        <Button
                          type="button"
                          variant="ghost"
                          size="icon"
                          className="h-full w-11 rounded-none border-l shrink-0"
                          onClick={() => {
                            const newCount = Math.min(5, tripData.travelers + 1)
                            const updatedNames = [...tripData.travelerNames]
                            const updatedGenders = [...tripData.travelerGenders]
                            while (updatedNames.length < newCount) updatedNames.push('')
                            while (updatedGenders.length < newCount) updatedGenders.push('')
                            setTripData({ ...tripData, travelers: newCount, travelerNames: updatedNames, travelerGenders: updatedGenders })
                          }}
                        >
                          +
                        </Button>
                      </div>
                    </div>
                  </div>

                  {/* Travel Period Detection (appears after dates are selected) */}
                  {peakDetection && (
                    <div className="space-y-2 animate-slide-up-fade" style={{ animationFillMode: 'both' }}>
                      {(peakDetection.seasonType === 'peak' || peakDetection.seasonType === 'mixed') && !peakOverride ? (
                        <div className={`p-3 rounded-lg border ${peakDetection.seasonType === 'mixed' ? 'bg-blue-50 dark:bg-blue-950/30 border-blue-200 dark:border-blue-800' : 'bg-amber-50 dark:bg-amber-950/30 border-amber-200 dark:border-amber-800'}`}>
                          <div className="flex items-start gap-2 mb-2">
                            <AlertTriangle className={`h-4 w-4 mt-0.5 flex-shrink-0 ${peakDetection.seasonType === 'mixed' ? 'text-blue-500' : 'text-amber-500'}`} />
                            <div>
                              <p className={`text-sm font-medium ${peakDetection.seasonType === 'mixed' ? 'text-blue-700 dark:text-blue-300' : 'text-amber-700 dark:text-amber-300'}`}>
                                {peakDetection.seasonType === 'mixed' ? 'Mixed Period Detected' : 'Peak Period Detected'}
                              </p>
                              <p className="text-xs text-muted-foreground mt-0.5">{peakDetection.summary}</p>
                            </div>
                          </div>
                          <div className="space-y-1.5 mt-2">
                            {peakDetection.overlappingPeriods.map((period) => (
                              <div key={period.name} className={`flex items-center justify-between px-2.5 py-1.5 rounded-md text-xs ${peakDetection.seasonType === 'mixed' ? 'bg-blue-100 dark:bg-blue-900/40' : 'bg-amber-100 dark:bg-amber-900/40'}`}>
                                <span className="font-medium">{period.name}</span>
                                <div className="flex items-center gap-2">
                                  <span className="text-muted-foreground">{period.dateRange}</span>
                                  <Badge variant="outline" className="text-[10px] px-1.5 py-0">
                                    {period.type === 'holiday' ? 'Holiday' : period.type === 'school-break' ? 'School Break' : 'Event'}
                                  </Badge>
                                </div>
                              </div>
                            ))}
                          </div>
                          <div className="flex items-center justify-between mt-3 pt-2 border-t border-amber-200 dark:border-amber-800">
                            <Label htmlFor="peak-override-step1" className="text-xs text-muted-foreground cursor-pointer">
                              Override: Optimize for off-peak instead?
                            </Label>
                            <Switch
                              id="peak-override-step1"
                              checked={peakOverride}
                              onCheckedChange={(checked) => {
                                setPeakOverride(checked)
                              }}
                            />
                          </div>
                        </div>
                      ) : peakDetection.seasonType === 'off-peak' || peakOverride ? (
                        <div className="p-3 rounded-lg bg-emerald-50 dark:bg-emerald-950/30 border border-emerald-200 dark:border-emerald-800">
                          <div className="flex items-start gap-2 mb-2">
                            <Leaf className="h-4 w-4 mt-0.5 text-emerald-500 flex-shrink-0" />
                            <div>
                              <p className="text-sm font-medium text-emerald-700 dark:text-emerald-300">Off-Peak Optimization</p>
                              <p className="text-xs text-muted-foreground mt-0.5">
                                {peakOverride
                                  ? 'AI will prioritize lower prices and quieter spots, even though your dates overlap with peak periods.'
                                  : peakDetection.summary}
                              </p>
                            </div>
                          </div>
                          <div className="grid grid-cols-2 gap-1.5 mt-2">
                            {[
                              { label: 'Lower prices', icon: TrendingDown },
                              { label: 'Fewer crowds', icon: Users },
                              { label: 'Better availability', icon: CalendarCheck },
                              { label: 'Sustainable travel', icon: Leaf },
                            ].map((benefit) => (
                              <div key={benefit.label} className="flex items-center gap-1.5 px-2 py-1 rounded-md bg-emerald-100 dark:bg-emerald-900/40 text-xs text-emerald-700 dark:text-emerald-300">
                                <benefit.icon className="h-3 w-3" />
                                <span>{benefit.label}</span>
                              </div>
                            ))}
                          </div>
                          {peakOverride && (
                            <div className="flex items-center justify-between mt-3 pt-2 border-t border-emerald-200 dark:border-emerald-800">
                              <Label htmlFor="peak-override-step1" className="text-xs text-muted-foreground cursor-pointer">
                                Override: Optimize for off-peak instead?
                              </Label>
                              <Switch
                                id="peak-override-step1"
                                checked={peakOverride}
                                onCheckedChange={(checked) => {
                                  setPeakOverride(checked)
                                }}
                              />
                            </div>
                          )}
                        </div>
                      ) : null}
                    </div>
                  )}

                  {/* Quick Generate Toggle */}
                  <div className="pt-2">
                    <div className="relative overflow-visible">
                      {/* Stars Explosion Animation - originates from toggle switch */}
                      {quickGenerate && (
                        <>
                          {[...Array(16)].map((_, i) => {
                            const angle = (i / 16) * 360 + (Math.random() * 30 - 15)
                            const distance = 40 + Math.random() * 40
                            const tx = Math.cos(angle * Math.PI / 180) * distance
                            const ty = Math.sin(angle * Math.PI / 180) * distance
                            const symbols = ['✦', '✧', '★', '✶', '✷', '✸']
                            const symbol = symbols[Math.floor(Math.random() * symbols.length)]
                            return (
                              <span
                                key={i}
                                className="absolute left-[34px] top-1/2 text-rose-400 animate-confetti-explode pointer-events-none z-10"
                                style={{
                                  '--tx': `${tx}px`,
                                  '--ty': `${ty}px`,
                                  animationDelay: `${Math.random() * 0.15}s`,
                                  fontSize: `${10 + Math.random() * 10}px`,
                                  color: `hsl(${350 + Math.random() * 20}, ${70 + Math.random() * 30}%, ${50 + Math.random() * 20}%)`
                                } as React.CSSProperties}
                              >
                                {symbol}
                              </span>
                            )
                          })}
                        </>
                      )}
                      <div className={`flex items-center gap-4 p-4 rounded-lg border transition-all duration-300 ${
                        quickGenerate
                          ? 'bg-rose-50 border-rose-300'
                          : 'bg-rose-50/50 border-rose-200'
                      }`}>
                        <Switch
                          id="quick-generate"
                          checked={quickGenerate}
                          onCheckedChange={setQuickGenerate}
                        />
                        <div className="flex-1">
                          <Label htmlFor="quick-generate" className="text-sm font-medium cursor-pointer">
                            Quick Generate
                          </Label>
                          <p className="text-sm text-muted-foreground">
                            Skip preferences and use smart defaults for faster planning
                          </p>
                        </div>
                        <Sparkles className={`h-5 w-5 transition-colors duration-300 ${quickGenerate ? 'text-rose-500' : 'text-muted-foreground'}`} />
                      </div>
                    </div>
                  </div>

                  {/* Submit Button */}
                  <Button
                    className={`w-full h-12 font-semibold text-base bg-gradient-to-r from-rose-500 to-rose-600 hover:from-rose-600 hover:to-rose-700 shadow-lg shadow-rose-500/20 transition-all duration-300 ${
                      tripData.destination && tripData.dateRange?.from && tripData.dateRange?.to
                        ? 'hover:scale-[1.02] hover:shadow-xl hover:shadow-rose-500/30'
                        : ''
                    }`}
                    onClick={handleDetailsSubmit}
                    disabled={!tripData.destination || !tripData.dateRange?.from || !tripData.dateRange?.to}
                  >
                    {quickGenerate ? (
                      <>Generate Plan <Sparkles className="ml-2 h-5 w-5 animate-pulse" /></>
                    ) : (
                      <>Continue to Preferences <ArrowRight className="ml-2 h-5 w-5" /></>
                    )}
                  </Button>

                </div>
              </CardContent>
            </Card>
          </div>
        )}

        {/* STEP 2: Preferences */}
        {currentStep === 'preferences' && (
          <div className="space-y-4 max-w-4xl mx-auto">
            {/* Hero Section */}
            <div className="text-center space-y-4 mb-6">
              <div className="flex justify-center animate-bounce-in">
                <div className="w-16 h-16 rounded-2xl bg-gradient-to-br from-rose-500 to-rose-600 flex items-center justify-center shadow-lg shadow-rose-500/25 animate-float-bounce">
                  <Settings2 className="h-8 w-8 text-white" />
                </div>
              </div>
              <div className="space-y-3 animate-slide-up-fade" style={{ animationDelay: '0.1s', animationFillMode: 'backwards' }}>
                <h2 className="text-2xl font-semibold text-foreground">Your Preferences</h2>
                <p className="text-muted-foreground text-sm">Customize your travel experience to match your style</p>
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() => setCurrentStep('details')}
                  className="gap-2 mt-2 border-rose-200 dark:border-rose-800 text-rose-600 dark:text-rose-400 hover:bg-rose-50 dark:hover:bg-rose-950/30 hover:border-rose-300 dark:hover:border-rose-700"
                >
                  <ChevronLeft className="h-4 w-4" />
                  Back to Trip Details
                </Button>
              </div>
            </div>

            {/* Off-peak override banner */}
            {peakOverride && peakDetection && (peakDetection.seasonType === 'peak' || peakDetection.seasonType === 'mixed') && (
              <div className="flex items-center gap-2.5 px-4 py-2.5 rounded-lg bg-emerald-50 dark:bg-emerald-950/30 border border-emerald-200 dark:border-emerald-800 animate-slide-up-fade">
                <Info className="h-4 w-4 text-emerald-500 flex-shrink-0" />
                <p className="text-xs text-emerald-700 dark:text-emerald-300">
                  <span className="font-medium">Off-peak override active</span>
                  <span className="text-emerald-600 dark:text-emerald-400"> — Your dates overlap with {peakDetection.overlappingPeriods.map(p => p.name).join(', ')}, but the AI will optimize for lower prices and quieter spots.</span>
                </p>
              </div>
            )}

            {/* Traveler Management Section */}
            <div className="mb-4 space-y-3">
              {/* Add/Remove Travelers Controls */}
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-2">
                  <Users className="h-4 w-4 text-rose-500" />
                  <span className="text-sm font-medium">Travelers</span>
                  <Badge variant="secondary" className="text-xs">
                    {tripData.travelers} {tripData.travelers === 1 ? 'person' : 'people'}
                  </Badge>
                </div>
                <div className="flex items-center gap-2">
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={() => {
                      if (tripData.travelers > 1) {
                        const newCount = tripData.travelers - 1
                        const updatedNames = tripData.travelerNames.slice(0, newCount)
                        const updatedGenders = tripData.travelerGenders.slice(0, newCount)
                        setTripData({
                          ...tripData,
                          travelers: newCount,
                          travelerNames: updatedNames,
                          travelerGenders: updatedGenders
                        })
                        setPreferences(prev => prev.slice(0, newCount))
                        if (currentTravelerIndex >= newCount) {
                          setCurrentTravelerIndex(newCount - 1)
                        }
                      }
                    }}
                    disabled={tripData.travelers <= 1}
                    className="h-8 w-8 p-0"
                  >
                    <UserMinus className="h-4 w-4" />
                  </Button>
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={() => {
                      if (tripData.travelers < 5) {
                        const newCount = tripData.travelers + 1
                        setTripData({
                          ...tripData,
                          travelers: newCount,
                          travelerNames: [...tripData.travelerNames, ''],
                          travelerGenders: [...tripData.travelerGenders, '']
                        })
                      }
                    }}
                    disabled={tripData.travelers >= 5}
                    className="h-8 w-8 p-0"
                  >
                    <UserPlus className="h-4 w-4" />
                  </Button>
                </div>
              </div>

              {/* Traveler Selection - Tabs for 2-4, Dropdown for 5 */}
              {tripData.travelers > 1 && (
                <>
                  {tripData.travelers <= 4 ? (
                    // Tabs for 2-4 travelers
                    <Tabs value={currentTravelerIndex.toString()} onValueChange={(v) => setCurrentTravelerIndex(parseInt(v))}>
                      <TabsList className="w-full grid" style={{ gridTemplateColumns: `repeat(${tripData.travelers}, 1fr)` }}>
                        {Array.from({ length: tripData.travelers }).map((_, index) => (
                          <TabsTrigger
                            key={index}
                            value={index.toString()}
                            className="text-sm relative"
                          >
                            {tripData.travelerNames[index] || `Traveler ${index + 1}`}
                            {submitAttempted && hasErrorsForTraveler(index) && (
                              <span className="absolute -top-1 -right-1 w-2 h-2 rounded-full bg-destructive" />
                            )}
                          </TabsTrigger>
                        ))}
                      </TabsList>
                    </Tabs>
                  ) : (
                    // Dropdown for 5 travelers
                    <div className="flex items-center gap-3">
                      <Label className="text-sm font-medium text-muted-foreground whitespace-nowrap">Select Traveler</Label>
                      <Select
                        value={currentTravelerIndex.toString()}
                        onValueChange={(v) => setCurrentTravelerIndex(parseInt(v))}
                      >
                        <SelectTrigger className="w-full h-10 font-[family-name:var(--font-geist-sans)]">
                          <SelectValue>
                            {tripData.travelerNames[currentTravelerIndex] || `Traveler ${currentTravelerIndex + 1}`}
                          </SelectValue>
                        </SelectTrigger>
                        <SelectContent className="font-[family-name:var(--font-geist-sans)]">
                          {Array.from({ length: tripData.travelers }).map((_, index) => (
                            <SelectItem key={index} value={index.toString()}>
                              <span className="flex items-center gap-2">
                                {tripData.travelerNames[index] || `Traveler ${index + 1}`}
                                {submitAttempted && hasErrorsForTraveler(index) && (
                                  <span className="w-2 h-2 rounded-full bg-destructive inline-block" />
                                )}
                              </span>
                            </SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                      <span className="text-sm text-muted-foreground whitespace-nowrap">
                        {currentTravelerIndex + 1} of {tripData.travelers}
                      </span>
                    </div>
                  )}
                </>
              )}
            </div>

            {/* Invite Friends Section - shown when travelers > 1 */}
            {tripData.travelers > 1 && (
              <Card className="border-rose-200 bg-rose-50/30">
                <CardContent className="p-4">
                  {!sharedTripId ? (
                    /* No shared trip yet — show invite button */
                    <div className="flex items-center justify-between gap-4">
                      <div className="flex items-center gap-3 min-w-0">
                        <div className="w-9 h-9 rounded-lg bg-rose-100 flex items-center justify-center shrink-0">
                          <UserPlus className="h-4 w-4 text-rose-500" />
                        </div>
                        <div className="min-w-0">
                          <p className="text-sm font-medium">Invite Friends</p>
                          <p className="text-xs text-muted-foreground">Let friends set their own preferences via a shareable link</p>
                        </div>
                      </div>
                      <Button
                        variant="outline"
                        size="sm"
                        className="shrink-0 border-rose-200 text-rose-600 hover:bg-rose-50 hover:border-rose-300 gap-1.5"
                        onClick={handleInviteFriends}
                        disabled={isCreatingTrip}
                      >
                        {isCreatingTrip ? (
                          <><Loader2 className="h-3.5 w-3.5 animate-spin" /> Creating...</>
                        ) : (
                          <><Link className="h-3.5 w-3.5" /> Get Link</>
                        )}
                      </Button>
                    </div>
                  ) : (
                    /* Shared trip exists — show link + participant status */
                    <div className="space-y-3">
                      {/* Link row */}
                      <div className="flex items-center gap-2">
                        <div className="flex-1 relative">
                          <Input
                            readOnly
                            value={typeof window !== 'undefined' ? `${window.location.origin}/predictions/join/${sharedTripId}` : ''}
                            className="h-9 text-xs bg-white font-mono pr-3"
                          />
                        </div>
                        <Button
                          variant="outline"
                          size="sm"
                          className={`h-9 gap-1.5 shrink-0 transition-all duration-200 ${
                            linkCopied
                              ? 'bg-emerald-50 border-emerald-300 text-emerald-600 hover:bg-emerald-50'
                              : 'border-rose-200 text-rose-600 hover:bg-rose-50'
                          }`}
                          onClick={() => {
                            navigator.clipboard.writeText(`${window.location.origin}/predictions/join/${sharedTripId}`)
                            setLinkCopied(true)
                            setTimeout(() => setLinkCopied(false), 2000)
                          }}
                        >
                          {linkCopied ? <><CheckCircle2 className="h-3.5 w-3.5" /> Copied</> : <><Copy className="h-3.5 w-3.5" /> Copy</>}
                        </Button>
                      </div>

                      {/* Participant status */}
                      <div className="space-y-1.5">
                        <div className="flex items-center justify-between">
                          <span className="text-xs font-medium text-muted-foreground">
                            {sharedTripData?.participants?.length || 1} of {tripData.travelers} joined
                          </span>
                          <Button
                            variant="ghost"
                            size="sm"
                            className="h-6 gap-1 text-[11px] text-muted-foreground hover:text-foreground px-2"
                            onClick={refreshTripStatus}
                          >
                            <RefreshCw className="h-3 w-3" /> Refresh
                          </Button>
                        </div>
                        {sharedTripData?.participants?.map((p: any, i: number) => (
                          <div key={p.id} className="flex items-center justify-between px-2.5 py-1.5 rounded-md bg-white border text-sm">
                            <div className="flex items-center gap-2">
                              <div className={`w-5 h-5 rounded-full flex items-center justify-center text-[9px] font-bold ${
                                i === 0 ? 'bg-rose-100 text-rose-600' : p.submittedAt ? 'bg-emerald-100 text-emerald-600' : 'bg-gray-100 text-gray-400'
                              }`}>
                                {p.name?.charAt(0)?.toUpperCase() || '?'}
                              </div>
                              <span className="text-sm">{p.name}</span>
                              {i === 0 && <Badge variant="secondary" className="text-[10px] px-1.5 py-0">You</Badge>}
                            </div>
                            {i === 0 ? (
                              <span className="text-[11px] text-muted-foreground">Creator</span>
                            ) : (
                              <Badge
                                variant={p.submittedAt ? 'default' : 'outline'}
                                className={
                                  p.submittedAt
                                    ? 'bg-emerald-100 text-emerald-700 hover:bg-emerald-100 border-emerald-200 text-[11px]'
                                    : 'text-amber-600 border-amber-200 bg-amber-50 hover:bg-amber-50 text-[11px]'
                                }
                              >
                                {p.submittedAt ? 'Submitted' : 'Pending'}
                              </Badge>
                            )}
                          </div>
                        ))}
                        {(sharedTripData?.participants?.length || 1) < tripData.travelers &&
                          Array.from({ length: tripData.travelers - (sharedTripData?.participants?.length || 1) }).map((_: unknown, i: number) => (
                            <div key={`empty-${i}`} className="flex items-center gap-2 px-2.5 py-1.5 rounded-md border border-dashed border-gray-200">
                              <div className="w-5 h-5 rounded-full border border-dashed border-gray-300 flex items-center justify-center">
                                <UserPlus className="h-2.5 w-2.5 text-gray-300" />
                              </div>
                              <span className="text-xs text-muted-foreground">Waiting to join...</span>
                            </div>
                          ))
                        }
                      </div>
                      <p className="text-[11px] text-muted-foreground flex items-start gap-1.5">
                        <Info className="h-3 w-3 mt-0.5 shrink-0 text-rose-400" />
                        Hit refresh to see updated status. Friends&apos; preferences will appear in their tabs once submitted.
                      </p>
                    </div>
                  )}
                </CardContent>
              </Card>
            )}

            {/* Friend submitted read-only banner */}
            {isFriendSubmitted(currentTravelerIndex) && (
              <div className="flex items-center gap-2.5 px-4 py-2.5 rounded-lg bg-emerald-50 border border-emerald-200">
                <CheckCircle2 className="h-4 w-4 text-emerald-500 shrink-0" />
                <p className="text-xs text-emerald-700">
                  <span className="font-medium">{tripData.travelerNames[currentTravelerIndex]}</span> has submitted their preferences. These fields are read-only.
                </p>
              </div>
            )}

            {(() => {
              const currentPrefs = preferences[currentTravelerIndex] || preferences[0]
              const isReadOnly = isFriendSubmitted(currentTravelerIndex)
              const updateCurrentPrefs = (updates: Partial<Preferences>) => {
                if (isReadOnly) return
                const updated = [...preferences]
                updated[currentTravelerIndex] = { ...updated[currentTravelerIndex], ...updates }
                setPreferences(updated)
              }
              return (
                <div className={`grid sm:grid-cols-2 gap-4 ${isReadOnly ? 'pointer-events-none opacity-75' : ''}`}>
                  {/* Left Column */}
                  <div className="space-y-3">
                    {/* Traveler Details */}
                    <Card className="animate-slide-up-fade" style={{ animationDelay: '0.1s', animationFillMode: 'both' }}>
                      <CardHeader className="pb-2 pt-3 px-4">
                        <CardTitle className="text-sm font-medium flex items-center gap-2">
                          <Users className="h-4 w-4 text-rose-500" />
                          Traveler Details
                        </CardTitle>
                      </CardHeader>
                      <CardContent className="px-4 pb-4">
                        <div className="space-y-3">
                          <div className="space-y-1.5">
                            <Label htmlFor={`name-${currentTravelerIndex}`} className="text-sm text-muted-foreground">Name</Label>
                            <Input
                              id={`name-${currentTravelerIndex}`}
                              ref={(el) => { if (el) nameInputRefs.current.set(currentTravelerIndex, el) }}
                              placeholder={`Enter traveler name`}
                              value={tripData.travelerNames[currentTravelerIndex] || ''}
                              autoComplete="off"
                              disabled={isReadOnly}
                              aria-invalid={shouldShowFieldError(currentTravelerIndex, 'name')}
                              onBlur={() => markTouched(currentTravelerIndex, 'name')}
                              onChange={(e) => {
                                if (isReadOnly) return
                                const updatedNames = [...tripData.travelerNames]
                                updatedNames[currentTravelerIndex] = e.target.value
                                setTripData({ ...tripData, travelerNames: updatedNames })
                              }}
                              className="h-10"
                            />
                            {!isReadOnly && shouldShowFieldError(currentTravelerIndex, 'name') && (
                              <p className="text-sm text-destructive mt-1">Name is required</p>
                            )}
                          </div>
                          <div className="space-y-1.5">
                            <Label htmlFor={`gender-${currentTravelerIndex}`} className="text-sm text-muted-foreground">Gender</Label>
                            <Select
                              value={tripData.travelerGenders[currentTravelerIndex] || ''}
                              disabled={isReadOnly}
                              onValueChange={(value) => {
                                if (isReadOnly) return
                                const updatedGenders = [...tripData.travelerGenders]
                                updatedGenders[currentTravelerIndex] = value
                                setTripData({ ...tripData, travelerGenders: updatedGenders })
                                markTouched(currentTravelerIndex, 'gender')
                              }}
                            >
                              <SelectTrigger
                                id={`gender-${currentTravelerIndex}`}
                                ref={(el) => { if (el) genderTriggerRefs.current.set(currentTravelerIndex, el) }}
                                className="h-10 font-[family-name:var(--font-geist-sans)]"
                                aria-invalid={shouldShowFieldError(currentTravelerIndex, 'gender')}
                                onBlur={() => markTouched(currentTravelerIndex, 'gender')}
                              >
                                <SelectValue placeholder="Select gender" />
                              </SelectTrigger>
                              <SelectContent className="font-[family-name:var(--font-geist-sans)]">
                                <SelectItem value="male">Male</SelectItem>
                                <SelectItem value="female">Female</SelectItem>
                                <SelectItem value="other">Other</SelectItem>
                                <SelectItem value="prefer-not-to-say">Prefer not to say</SelectItem>
                              </SelectContent>
                            </Select>
                            {!isReadOnly && shouldShowFieldError(currentTravelerIndex, 'gender') && (
                              <p className="text-sm text-destructive mt-1">Gender is required</p>
                            )}
                          </div>
                        </div>
                      </CardContent>
                    </Card>

                    {/* Budget */}
                    <Card className="animate-slide-up-fade" style={{ animationDelay: '0.15s', animationFillMode: 'both' }}>
                      <CardHeader className="pb-2 pt-3 px-4">
                        <CardTitle className="text-sm font-medium flex items-center gap-2">
                          <DollarSign className="h-4 w-4 text-rose-500" />
                          Budget
                        </CardTitle>
                        <p className="text-sm text-muted-foreground">Per person estimate</p>
                      </CardHeader>
                      <CardContent className="px-4 pb-4">
                        <div className="grid grid-cols-2 gap-3">
                          <div className="space-y-1.5">
                            <Label htmlFor="budget-min" className="text-sm text-muted-foreground">Minimum</Label>
                            <div className="relative">
                              <span className="absolute left-3 top-1/2 -translate-y-1/2 text-sm text-muted-foreground">RM</span>
                              <Input
                                id="budget-min"
                                placeholder="0"
                                value={currentPrefs.budgetMin}
                                autoComplete="off"
                                inputMode="numeric"
                                maxLength={6}
                                onChange={(e) => {
                                  const value = e.target.value.replace(/\D/g, '').slice(0, 6)
                                  updateCurrentPrefs({ budgetMin: value })
                                }}
                                className="h-10 pl-10"
                              />
                            </div>
                          </div>
                          <div className="space-y-1.5">
                            <Label htmlFor="budget-max" className="text-sm text-muted-foreground">Maximum</Label>
                            <div className="relative">
                              <span className="absolute left-3 top-1/2 -translate-y-1/2 text-sm text-muted-foreground">RM</span>
                              <Input
                                id="budget-max"
                                ref={(el) => { if (el) budgetMaxInputRefs.current.set(currentTravelerIndex, el) }}
                                placeholder="5000"
                                value={currentPrefs.budgetMax}
                                autoComplete="off"
                                inputMode="numeric"
                                maxLength={6}
                                aria-invalid={shouldShowFieldError(currentTravelerIndex, 'budgetMax')}
                                onBlur={() => markTouched(currentTravelerIndex, 'budgetMax')}
                                onChange={(e) => {
                                  const value = e.target.value.replace(/\D/g, '').slice(0, 6)
                                  updateCurrentPrefs({ budgetMax: value })
                                }}
                                className="h-10 pl-10"
                              />
                            </div>
                            {shouldShowFieldError(currentTravelerIndex, 'budgetMax') && (
                              <p className="text-sm text-destructive mt-1">Maximum budget is required</p>
                            )}
                          </div>
                        </div>
                      </CardContent>
                    </Card>

                    {/* Travel Style */}
                    <Card className="animate-slide-up-fade" style={{ animationDelay: '0.2s', animationFillMode: 'both' }}>
                      <CardHeader className="pb-2 pt-3 px-4">
                        <CardTitle className="text-sm font-medium flex items-center gap-2">
                          <Plane className="h-4 w-4 text-rose-500" />
                          Travel Style
                        </CardTitle>
                      </CardHeader>
                      <CardContent className="px-4 pb-4">
                        <RadioGroup
                          value={currentPrefs.travelStyle}
                          onValueChange={(v) => updateCurrentPrefs({ travelStyle: v })}
                          className="space-y-2"
                        >
                          {[
                            { value: 'low-budget', label: 'Budget', desc: 'Affordable options, save more' },
                            { value: 'balanced', label: 'Balanced', desc: 'Mix of value and comfort' },
                            { value: 'comfortable', label: 'Comfortable', desc: 'Premium experiences' }
                          ].map((option) => (
                            <Label
                              key={option.value}
                              htmlFor={`style-${option.value}`}
                              className={`flex items-center gap-3 p-3 border rounded-lg cursor-pointer transition-all ${
                                currentPrefs.travelStyle === option.value
                                  ? 'border-rose-500 bg-rose-50'
                                  : 'border-border hover:border-rose-300'
                              }`}
                            >
                              <RadioGroupItem value={option.value} id={`style-${option.value}`} />
                              <div className="flex-1">
                                <div className="text-sm font-medium">{option.label}</div>
                                <div className="text-sm text-muted-foreground">{option.desc}</div>
                              </div>
                            </Label>
                          ))}
                        </RadioGroup>
                      </CardContent>
                    </Card>

                    {/* Safety Options */}
                    <Card className="animate-slide-up-fade" style={{ animationDelay: '0.25s', animationFillMode: 'both' }}>
                      <CardHeader className="pb-2 pt-3 px-4">
                        <CardTitle className="text-sm font-medium flex items-center gap-2">
                          <Shield className="h-4 w-4 text-rose-500" />
                          Safety Options
                        </CardTitle>
                      </CardHeader>
                      <CardContent className="px-4 pb-3">
                        {shouldShowFieldError(currentTravelerIndex, 'safety') && (
                          <p className="text-sm text-destructive mb-2">Select at least one safety option</p>
                        )}
                        <div className={shouldShowFieldError(currentTravelerIndex, 'safety') ? 'ring-1 ring-destructive rounded-lg p-2' : ''}>
                        {[
                          { id: 'avoidLateNight', label: 'Avoid late-night activities' },
                          { id: 'preferWellLit', label: 'Prefer well-lit areas' },
                          { id: 'verifiedTransport', label: 'Verified transport only' }
                        ].map((option) => (
                          <div key={option.id} className="flex items-center justify-between py-2">
                            <Label htmlFor={option.id} className="text-sm cursor-pointer">{option.label}</Label>
                            <Switch
                              id={option.id}
                              checked={currentPrefs.safetyOptions[option.id as keyof typeof currentPrefs.safetyOptions]}
                              onCheckedChange={(checked) => {
                                updateCurrentPrefs({
                                  safetyOptions: { ...currentPrefs.safetyOptions, [option.id]: checked }
                                })
                                markTouched(currentTravelerIndex, 'safety')
                              }}
                            />
                          </div>
                        ))}
                        </div>
                      </CardContent>
                    </Card>
                  </div>

                  {/* Right Column */}
                  <div className="space-y-3">
                    {/* Travel Period */}
                    <Card className="animate-slide-up-fade" style={{ animationDelay: '0.1s', animationFillMode: 'both' }}>
                      <CardHeader className="pb-2 pt-3 px-4">
                        <CardTitle className="text-sm font-medium flex items-center gap-2">
                          <Calendar className="h-4 w-4 text-rose-500" />
                          Travel Period
                        </CardTitle>
                      </CardHeader>
                      <CardContent className="px-4 pb-3">
                        {!peakDetection ? (
                          <div className="p-3 rounded-lg bg-muted/50 border border-dashed">
                            <p className="text-xs text-muted-foreground text-center">
                              No dates selected — go back to Step 1 to pick travel dates.
                            </p>
                          </div>
                        ) : (() => {
                          const effectiveType = peakOverride ? 'off-peak' : peakDetection.seasonType
                          return (
                            <>
                              {/* Detected season — styled like a selected radio option */}
                              <div className={`flex items-center gap-3 p-3 border rounded-lg transition-all ${
                                effectiveType === 'off-peak'
                                  ? 'border-rose-500 bg-rose-50'
                                  : effectiveType === 'mixed'
                                  ? 'border-rose-500 bg-rose-50'
                                  : 'border-rose-500 bg-rose-50'
                              }`}>
                                <div className="w-4 h-4 rounded-full border-2 border-rose-500 flex items-center justify-center flex-shrink-0">
                                  <div className="w-2 h-2 rounded-full bg-rose-500" />
                                </div>
                                <div className="flex-1">
                                  <div className="text-sm font-medium">
                                    {effectiveType === 'off-peak' ? 'Off-Peak Season' : effectiveType === 'mixed' ? 'Mixed Season' : 'Peak Season'}
                                    {peakOverride && <span className="text-xs font-normal text-muted-foreground ml-1">(overridden)</span>}
                                  </div>
                                  <div className="text-sm text-muted-foreground">
                                    {effectiveType === 'off-peak'
                                      ? 'Lower prices, fewer crowds'
                                      : effectiveType === 'peak'
                                      ? 'Higher demand, festive atmosphere'
                                      : 'Mix of busy and quiet days'}
                                  </div>
                                </div>
                              </div>

                              {/* Overlapping periods list — styled like switch rows */}
                              {peakDetection.overlappingPeriods.length > 0 && !peakOverride && (
                                <div className="mt-2">
                                  {peakDetection.overlappingPeriods.map((period) => (
                                    <div key={period.name} className="flex items-center justify-between py-2">
                                      <div className="flex items-center gap-2">
                                        <CalendarCheck className="h-3.5 w-3.5 text-rose-500" />
                                        <Label className="text-sm">{period.name}</Label>
                                      </div>
                                      <span className="text-sm text-muted-foreground">{period.dateRange}</span>
                                    </div>
                                  ))}
                                </div>
                              )}

                              {/* Optimize toggle — styled like safety/alert switches */}
                              {(peakDetection.seasonType === 'peak' || peakDetection.seasonType === 'mixed') && (
                                <div className="flex items-center justify-between py-2 mt-1 border-t">
                                  <Label htmlFor="peak-override-step2" className="text-sm cursor-pointer">Optimize for off-peak</Label>
                                  <Switch
                                    id="peak-override-step2"
                                    checked={peakOverride}
                                    onCheckedChange={(checked) => {
                                      setPeakOverride(checked)
                                      if (checked) {
                                        updateCurrentPrefs({ seasonType: 'off-peak', preferredSeasons: [] })
                                      } else if (peakDetection) {
                                        updateCurrentPrefs({
                                          seasonType: peakDetection.seasonType,
                                          preferredSeasons: peakDetection.overlappingPeriods.map(op => op.name),
                                        })
                                      }
                                    }}
                                  />
                                </div>
                              )}
                            </>
                          )
                        })()}
                      </CardContent>
                    </Card>

                    {/* Crowd Preference */}
                    <Card className="animate-slide-up-fade" style={{ animationDelay: '0.15s', animationFillMode: 'both' }}>
                      <CardHeader className="pb-2 pt-3 px-4">
                        <CardTitle className="text-sm font-medium flex items-center gap-2">
                          <Users className="h-4 w-4 text-rose-500" />
                          Crowd Preference
                        </CardTitle>
                      </CardHeader>
                      <CardContent className="px-4 pb-4">
                        <RadioGroup
                          value={currentPrefs.crowdTolerance}
                          onValueChange={(v) => updateCurrentPrefs({ crowdTolerance: v })}
                          className="space-y-2"
                        >
                          {[
                            { value: 'avoid-crowd', label: 'Avoid crowds', desc: 'Quieter spots, off-peak times' },
                            { value: 'okay-crowd', label: 'Okay with crowds', desc: 'Popular attractions are fine' },
                            { value: 'no-preference', label: 'No preference', desc: 'Flexible with any crowd level' }
                          ].map((option) => (
                            <Label
                              key={option.value}
                              htmlFor={`crowd-${option.value}`}
                              className={`flex items-center gap-3 p-3 border rounded-lg cursor-pointer transition-all ${
                                currentPrefs.crowdTolerance === option.value
                                  ? 'border-rose-500 bg-rose-50'
                                  : 'border-border hover:border-rose-300'
                              }`}
                            >
                              <RadioGroupItem value={option.value} id={`crowd-${option.value}`} />
                              <div className="flex-1">
                                <div className="text-sm font-medium">{option.label}</div>
                                <div className="text-sm text-muted-foreground">{option.desc}</div>
                              </div>
                            </Label>
                          ))}
                        </RadioGroup>
                      </CardContent>
                    </Card>

                    {/* Alert Preferences */}
                    <Card className="animate-slide-up-fade" style={{ animationDelay: '0.2s', animationFillMode: 'both' }}>
                      <CardHeader className="pb-2 pt-3 px-4">
                        <CardTitle className="text-sm font-medium flex items-center gap-2">
                          <Bell className="h-4 w-4 text-rose-500" />
                          Alert Preferences
                        </CardTitle>
                      </CardHeader>
                      <CardContent className="px-4 pb-3">
                        {shouldShowFieldError(currentTravelerIndex, 'alerts') && (
                          <p className="text-sm text-destructive mb-2">Select at least one alert preference</p>
                        )}
                        <div className={shouldShowFieldError(currentTravelerIndex, 'alerts') ? 'ring-1 ring-destructive rounded-lg p-2' : ''}>
                        {[
                          { id: 'crowd', label: 'Crowd alerts' },
                          { id: 'weather', label: 'Weather alerts' },
                          { id: 'price', label: 'Price drops' },
                          { id: 'safety', label: 'Safety warnings' }
                        ].map((option) => (
                          <div key={option.id} className="flex items-center justify-between py-2">
                            <Label htmlFor={`alert-${option.id}`} className="text-sm cursor-pointer">{option.label}</Label>
                            <Switch
                              id={`alert-${option.id}`}
                              checked={currentPrefs.notifications[option.id as keyof typeof currentPrefs.notifications]}
                              onCheckedChange={(checked) => {
                                updateCurrentPrefs({
                                  notifications: { ...currentPrefs.notifications, [option.id]: checked }
                                })
                                markTouched(currentTravelerIndex, 'alerts')
                              }}
                            />
                          </div>
                        ))}
                        </div>
                      </CardContent>
                    </Card>
                  </div>
                </div>
              )
            })()}

            {/* Submit Button */}
            <div className="pt-4 space-y-2">
              {(() => {
                // If shared trip exists, check if friends have submitted
                const friends = sharedTripData?.participants?.slice(1) || []
                const allFriendsSubmitted = sharedTripData &&
                  sharedTripData.participants?.length >= sharedTripData.tripDetails?.totalTravelers &&
                  friends.length > 0 &&
                  friends.every((p: any) => p.submittedAt !== null)
                const isSharedReady = sharedTripData?.status === 'ready' || allFriendsSubmitted

                if (sharedTripId && isSharedReady) {
                  return (
                    <Button
                      className="w-full h-11 font-semibold bg-gradient-to-r from-rose-500 to-rose-600 hover:from-rose-600 hover:to-rose-700 shadow-lg shadow-rose-500/20"
                      onClick={handleGenerateWithSharedPreferences}
                    >
                      Generate Plan with Everyone&apos;s Preferences
                      <Sparkles className="ml-2 h-4 w-4" />
                    </Button>
                  )
                }

                if (sharedTripId && !isSharedReady) {
                  return (
                    <Button
                      className="w-full h-11 font-semibold bg-gray-100 text-gray-400 shadow-none cursor-not-allowed"
                      disabled
                    >
                      Waiting for friends to submit preferences...
                    </Button>
                  )
                }

                // Normal flow — no shared trip
                return (
                  <>
                    <Button
                      className="w-full h-11 font-semibold bg-gradient-to-r from-rose-500 to-rose-600 hover:from-rose-600 hover:to-rose-700 shadow-lg shadow-rose-500/20"
                      onClick={handlePreferencesSubmit}
                    >
                      Generate Travel Plan
                      <Sparkles className="ml-2 h-4 w-4" />
                    </Button>
                    {submitAttempted && !isPreferencesValid && (
                      <p className="text-sm text-destructive text-center mt-2">
                        Please fill in all required fields for each traveler
                      </p>
                    )}
                  </>
                )
              })()}
            </div>
          </div>
        )}

        {/* STEP 3: Results */}
        {currentStep === 'results' && (
          <div className="space-y-3">
            {/* Trip Header */}
            <div className="bg-card text-card-foreground rounded-xl border shadow-sm font-[family-name:var(--font-geist-sans)] overflow-hidden animate-fade-in-up" style={{ animationDelay: '0s', animationFillMode: 'backwards' }}>
              {/* Top Section with Gradient */}
              <div className="bg-gradient-to-r from-rose-500 to-rose-600 px-5 py-4">
                <div className="flex items-start justify-between gap-4">
                  <div className="flex items-center gap-3">
                    <div className="w-12 h-12 rounded-xl bg-white/20 backdrop-blur-sm flex items-center justify-center animate-bounce-in" style={{ animationDelay: '0.2s', animationFillMode: 'backwards' }}>
                      <MapPinIcon className="h-6 w-6 text-white" />
                    </div>
                    <div>
                      <p className="text-rose-100 text-xs font-medium mb-0.5">Your Destination</p>
                      <h1 className="text-xl font-bold text-white">{tripData.destination}</h1>
                    </div>
                  </div>
                  <div className="flex items-center gap-2">
                    <Button
                      size="sm"
                      className="h-9 bg-white/20 hover:bg-white/30 backdrop-blur-sm border-0 text-white text-xs font-semibold"
                      onClick={() => {
                        setCurrentStep('details')
                        setGeneratedPlan(null)
                        setQuickGenerateData(null)
                        setTripData({
                          destination: '',
                          dateRange: undefined,
                          travelers: 1,
                          travelerNames: [''],
                          travelerGenders: ['']
                        })
                        setPreferences([{
                          travelStyle: 'balanced',
                          crowdTolerance: 'avoid-crowd',
                          seasonType: 'no-preference',
                          preferredSeasons: [],
                          safetyOptions: {
                            avoidLateNight: true,
                            preferWellLit: true,
                            verifiedTransport: true
                          },
                          budgetMin: '',
                          budgetMax: '',
                          notifications: {
                            crowd: true,
                            weather: true,
                            price: true,
                            safety: true
                          }
                        }])
                        setCurrentTravelerIndex(0)
                        setSelectedPlan('Balanced Plan')
                        setSubmitAttempted(false)
                        setTouchedFields(new Set())
                        setPeakOverride(false)
                      }}
                    >
                      <Plus className="h-3.5 w-3.5 sm:mr-1" />
                      <span className="hidden sm:inline">New Plan</span>
                    </Button>
                    {streamingMode === null && (
                      <>
                        <Button
                          size="sm"
                          className="h-9 bg-white hover:bg-white/90 text-rose-600 text-xs font-semibold"
                          onClick={() => setShowSaveDialog(true)}
                        >
                          <CheckCircle2 className="h-3.5 w-3.5 sm:mr-1" />
                          <span className="hidden sm:inline">Save Plan</span>
                        </Button>
                        <Popover>
                        <PopoverTrigger asChild>
                          <Button size="icon" className="h-9 w-9 bg-white/20 hover:bg-white/30 backdrop-blur-sm border-0">
                            <Share2 className="h-4 w-4 text-white" />
                          </Button>
                        </PopoverTrigger>
                        <PopoverContent align="end" className="w-48 p-2 font-[family-name:var(--font-geist-sans)]">
                          <p className="text-xs font-medium text-muted-foreground px-2 mb-2">Share this plan</p>
                          {[
                            { name: 'WhatsApp', icon: MessageCircle, bg: 'bg-green-500' },
                            { name: 'Email', icon: Mail, bg: 'bg-blue-500' },
                            { name: 'Facebook', icon: Facebook, bg: 'bg-blue-600' },
                            { name: 'Instagram', icon: Instagram, bg: 'bg-gradient-to-br from-purple-500 via-pink-500 to-orange-400' },
                            { name: 'Threads', icon: AtSign, bg: 'bg-black dark:bg-white dark:text-black' },
                          ].map((item) => (
                            <Button
                              key={item.name}
                              variant="ghost"
                              className="w-full justify-start gap-2.5 h-9 px-2 hover:bg-muted"
                              onClick={() => {
                                setSharedPlatform(item.name)
                                setShowShareSuccess(true)
                              }}
                            >
                              <div className={`w-6 h-6 rounded-md ${item.bg} flex items-center justify-center`}>
                                <item.icon className="h-3.5 w-3.5 text-white" />
                              </div>
                              <span className="text-sm font-medium">{item.name}</span>
                            </Button>
                          ))}
                        </PopoverContent>
                      </Popover>
                    </>
                    )}
                </div>
              </div>
            </div>

              {/* Bottom Section with Trip Details */}
              <div className="p-4">
                <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
                  {/* Trip Info Pills */}
                  <div className="flex items-center gap-2 flex-wrap">
                    <div className="flex items-center gap-2 px-3 py-1.5 rounded-full bg-rose-50 dark:bg-rose-950/30">
                      <Calendar className="h-4 w-4 text-rose-600" />
                      <span className="text-sm font-medium">{formatDateRange(tripData.dateRange)}</span>
                    </div>
                    <div className="flex items-center gap-2 px-3 py-1.5 rounded-full bg-rose-50 dark:bg-rose-950/30">
                      <Users className="h-4 w-4 text-rose-600" />
                      <span className="text-sm font-medium">{tripData.travelers} {tripData.travelers === 1 ? 'person' : 'people'}</span>
                    </div>
                  </div>

                  {/* Quick Plan Generation Label - Only for quick generate mode */}
                  {quickGenerateData && (
                    <div className="flex items-center gap-2 px-3 py-1.5 rounded-full bg-gradient-to-r from-rose-100 to-rose-50 dark:from-rose-900/30 dark:to-rose-950/20 border border-rose-200 dark:border-rose-800/30">
                      <Zap className="h-4 w-4 text-rose-500" />
                      <span className="text-sm font-medium text-rose-600 dark:text-rose-400">Quick Plan Generation</span>
                    </div>
                  )}
                </div>
              </div>
            </div>

            {/* Off-peak override banner */}
            {peakOverride && peakDetection && (peakDetection.seasonType === 'peak' || peakDetection.seasonType === 'mixed') && (
              <div className="flex items-center gap-2.5 px-4 py-2.5 rounded-lg bg-emerald-50 dark:bg-emerald-950/30 border border-emerald-200 dark:border-emerald-800 animate-fade-in-up" style={{ animationDelay: '0.1s', animationFillMode: 'backwards' }}>
                <Info className="h-4 w-4 text-emerald-500 flex-shrink-0" />
                <p className="text-xs text-emerald-700 dark:text-emerald-300">
                  <span className="font-medium">Off-peak override active</span>
                  <span className="text-emerald-600 dark:text-emerald-400"> — Plans were optimized for lower prices and quieter spots, even though your dates overlap with {peakDetection.overlappingPeriods.map(p => p.name).join(', ')}.</span>
                </p>
              </div>
            )}

            {/* Traveler Preferences Dialog */}
            <Dialog open={showAllPreferences} onOpenChange={setShowAllPreferences}>
              <DialogContent className="w-[calc(100%-2rem)] sm:max-w-lg max-h-[85vh] p-0 flex flex-col gap-0 font-[family-name:var(--font-geist-sans)]">
                <DialogHeader className="px-5 py-4 border-b bg-muted/30">
                  <div className="flex items-center gap-3">
                    <div className="w-10 h-10 rounded-full bg-rose-100 dark:bg-rose-900/30 flex items-center justify-center">
                      <Users className="h-5 w-5 text-rose-500" />
                    </div>
                    <div>
                      <DialogTitle className="text-sm font-semibold">Group Preferences</DialogTitle>
                      <DialogDescription className="text-xs">
                        {tripData.destination} · {tripData.travelers} {tripData.travelers === 1 ? 'traveler' : 'travelers'}
                      </DialogDescription>
                    </div>
                  </div>
                </DialogHeader>

                <ScrollArea className="flex-1">
                  <div className="p-4 space-y-3">
                    {tripData.travelerNames.map((name, index) => {
                      const travelerName = name || `Traveler ${index + 1}`
                      const colors = ['bg-rose-500', 'bg-blue-500', 'bg-emerald-500', 'bg-amber-500', 'bg-purple-500']
                      const pref = preferences[index] || preferences[0]
                      const gender = tripData.travelerGenders[index]

                      const getTravelStyleConfig = () => {
                        if (pref.travelStyle === 'low-budget') return { label: 'Budget', icon: DollarSign, color: 'text-emerald-600', bg: 'bg-emerald-50 dark:bg-emerald-950/30' }
                        if (pref.travelStyle === 'comfortable') return { label: 'Comfort', icon: Sparkles, color: 'text-purple-600', bg: 'bg-purple-50 dark:bg-purple-950/30' }
                        return { label: 'Balanced', icon: Activity, color: 'text-blue-600', bg: 'bg-blue-50 dark:bg-blue-950/30' }
                      }
                      const travelStyle = getTravelStyleConfig()

                      const getCrowdConfig = () => {
                        if (pref.crowdTolerance === 'avoid-crowd') return { label: 'Avoid Crowds', icon: Users, color: 'text-teal-600', bg: 'bg-teal-50 dark:bg-teal-950/30' }
                        if (pref.crowdTolerance === 'okay-crowd') return { label: 'Crowds OK', icon: Users, color: 'text-amber-600', bg: 'bg-amber-50 dark:bg-amber-950/30' }
                        return { label: 'Any Crowd', icon: Users, color: 'text-gray-600', bg: 'bg-gray-50 dark:bg-gray-800/30' }
                      }
                      const crowdPref = getCrowdConfig()

                      const safetyCount = [pref.safetyOptions.avoidLateNight, pref.safetyOptions.preferWellLit, pref.safetyOptions.verifiedTransport].filter(Boolean).length

                      return (
                        <div key={index} className="border rounded-xl p-4 bg-card hover:shadow-sm transition-shadow">
                          {/* Traveler Header */}
                          <div className="flex items-center gap-3 mb-3">
                            <div className={`w-9 h-9 rounded-full ${colors[index % colors.length]} flex items-center justify-center text-white font-semibold text-xs shadow-sm`}>
                              {travelerName.charAt(0).toUpperCase()}
                            </div>
                            <div className="flex-1 min-w-0">
                              <p className="text-sm font-semibold truncate">{travelerName}</p>
                              {gender && (
                                <p className="text-xs text-muted-foreground capitalize">{gender}</p>
                              )}
                            </div>
                            <Badge variant="outline" className="text-xs shrink-0">
                              Traveler {index + 1}
                            </Badge>
                          </div>

                          {/* Preferences Grid */}
                          <div className="grid grid-cols-2 gap-2">
                            {/* Travel Style */}
                            <div className={`flex items-center gap-2.5 px-3 py-2.5 rounded-lg ${travelStyle.bg}`}>
                              <travelStyle.icon className={`h-4 w-4 shrink-0 ${travelStyle.color}`} />
                              <div className="min-w-0">
                                <p className="text-xs text-muted-foreground">Style</p>
                                <p className={`text-sm font-semibold ${travelStyle.color}`}>{travelStyle.label}</p>
                              </div>
                            </div>

                            {/* Budget */}
                            <div className="flex items-center gap-2.5 px-3 py-2.5 rounded-lg bg-emerald-50 dark:bg-emerald-950/30">
                              <DollarSign className="h-4 w-4 shrink-0 text-emerald-600" />
                              <div className="min-w-0">
                                <p className="text-xs text-muted-foreground">Budget</p>
                                <p className="text-sm font-semibold text-emerald-600 truncate">
                                  {pref.budgetMax ? `RM ${pref.budgetMax}` : 'Flexible'}
                                </p>
                              </div>
                            </div>

                            {/* Crowd Preference */}
                            <div className={`flex items-center gap-2.5 px-3 py-2.5 rounded-lg ${crowdPref.bg}`}>
                              <crowdPref.icon className={`h-4 w-4 shrink-0 ${crowdPref.color}`} />
                              <div className="min-w-0">
                                <p className="text-xs text-muted-foreground">Crowd</p>
                                <p className={`text-sm font-semibold ${crowdPref.color}`}>{crowdPref.label}</p>
                              </div>
                            </div>

                            {/* Safety */}
                            <div className="flex items-center gap-2.5 px-3 py-2.5 rounded-lg bg-rose-50 dark:bg-rose-950/30">
                              <Shield className="h-4 w-4 shrink-0 text-rose-600" />
                              <div className="min-w-0">
                                <p className="text-xs text-muted-foreground">Safety</p>
                                <p className="text-sm font-semibold text-rose-600">
                                  {safetyCount === 3 ? 'All enabled' : safetyCount === 0 ? 'None' : `${safetyCount} option${safetyCount > 1 ? 's' : ''}`}
                                </p>
                              </div>
                            </div>
                          </div>

                          {/* Safety Details */}
                          {safetyCount > 0 && (
                            <div className="mt-3 pt-3 border-t">
                              <div className="flex flex-wrap gap-1.5">
                                {pref.safetyOptions.avoidLateNight && (
                                  <Badge variant="secondary" className="text-xs gap-1.5">
                                    <Clock className="h-3 w-3" />
                                    No late nights
                                  </Badge>
                                )}
                                {pref.safetyOptions.preferWellLit && (
                                  <Badge variant="secondary" className="text-xs gap-1.5">
                                    <Sun className="h-3 w-3" />
                                    Well-lit areas
                                  </Badge>
                                )}
                                {pref.safetyOptions.verifiedTransport && (
                                  <Badge variant="secondary" className="text-xs gap-1.5">
                                    <CheckCircle2 className="h-3 w-3" />
                                    Verified transport
                                  </Badge>
                                )}
                              </div>
                            </div>
                          )}
                        </div>
                      )
                    })}
                  </div>
                </ScrollArea>

                <div className="px-5 py-4 border-t bg-muted/30 flex items-center justify-between">
                  <p className="text-xs text-muted-foreground">
                    {tripData.travelers} traveler{tripData.travelers > 1 ? 's' : ''} configured
                  </p>
                  <Button size="sm" onClick={() => setShowAllPreferences(false)} className="bg-rose-500 hover:bg-rose-600">
                    Done
                  </Button>
                </div>
              </DialogContent>
            </Dialog>

            {/* Share Success Dialog */}
            <Dialog open={showShareSuccess} onOpenChange={setShowShareSuccess}>
              <DialogContent className="w-[calc(100%-2rem)] sm:max-w-sm p-0 overflow-hidden font-[family-name:var(--font-geist-sans)]">
                <DialogHeader className="sr-only">
                  <DialogTitle>Share Success</DialogTitle>
                </DialogHeader>
                <div className="p-6 text-center">
                  {/* Success Animation */}
                  <div className="relative mx-auto w-16 h-16 mb-4">
                    <div className="absolute inset-0 rounded-full bg-emerald-100 dark:bg-emerald-900/30 animate-ping opacity-25" />
                    <div className="relative w-16 h-16 rounded-full bg-gradient-to-br from-emerald-400 to-emerald-500 flex items-center justify-center shadow-lg animate-bounce-in">
                      <CheckCircle2 className="h-8 w-8 text-white" />
                    </div>
                  </div>

                  {/* Success Message */}
                  <h3 className="text-lg font-semibold mb-2">Shared Successfully!</h3>
                  <p className="text-sm text-muted-foreground mb-4">
                    Your travel plan has been shared via <span className="font-medium text-foreground">{sharedPlatform}</span>.
                    Your friends and family can now view your trip details.
                  </p>

                  {/* Destination Info */}
                  <div className="inline-flex items-center gap-2 px-3 py-1.5 rounded-full bg-rose-50 dark:bg-rose-950/30 mb-4">
                    <MapPinIcon className="h-3.5 w-3.5 text-rose-500" />
                    <span className="text-sm font-medium">{tripData.destination}</span>
                  </div>

                  {/* Close Button */}
                  <Button
                    onClick={() => setShowShareSuccess(false)}
                    className="w-full bg-rose-500 hover:bg-rose-600"
                  >
                    Done
                  </Button>
                </div>
              </DialogContent>
            </Dialog>

            {/* Quick Generate View - Minimal Design (per-section progressive reveal) */}

            {/* Quick Overview */}
            {quickGenerateData && contentVisible.has('q-overview') ? (
                <div className="rounded-xl border bg-gradient-to-br from-rose-50 to-transparent dark:from-rose-950/20 dark:to-transparent p-4 animate-fade-in-up" style={{ animationDelay: '0s', animationFillMode: 'backwards' }}>
                  {/* Header */}
                  <div className="flex items-center gap-2 mb-4">
                    <div className="w-8 h-8 rounded-lg bg-rose-100 dark:bg-rose-900/30 flex items-center justify-center">
                      <Sparkles className="h-4 w-4 text-rose-500" />
                    </div>
                    <h3 className="text-sm font-semibold">Quick Overview</h3>
                  </div>

                  {/* Content Grid */}
                  <div className="grid sm:grid-cols-2 gap-4">
                    {/* Left Column - Budget & Highlights */}
                    <div className="space-y-3">
                      <div>
                        <p className="text-xs text-muted-foreground mb-1">Estimated Budget</p>
                        <p className="text-2xl font-bold">{quickGenerateData.summary?.estimatedBudget || 'RM 500 - RM 1,500'}</p>
                        <p className="text-xs text-muted-foreground">per person</p>
                      </div>
                      {quickGenerateData.summary?.highlights && quickGenerateData.summary.highlights.length > 0 && (
                        <div className="flex flex-wrap gap-1.5">
                          {quickGenerateData.summary.highlights.map((highlight: string, idx: number) => (
                            <Badge key={idx} variant="secondary" className="text-xs">
                              {highlight}
                            </Badge>
                          ))}
                        </div>
                      )}
                    </div>

                    {/* Right Column - Stats */}
                    <div className="grid grid-cols-2 gap-2">
                      <div className="flex items-center gap-2.5 p-3 rounded-lg bg-white/60 dark:bg-white/5 border border-rose-100 dark:border-rose-900/30">
                        <Clock className="h-4 w-4 text-blue-500 shrink-0" />
                        <div>
                          <p className="text-xs text-muted-foreground">Best Time</p>
                          <p className="text-sm font-semibold">Morning</p>
                        </div>
                      </div>
                      <div className="flex items-center gap-2.5 p-3 rounded-lg bg-white/60 dark:bg-white/5 border border-rose-100 dark:border-rose-900/30">
                        <Users className={`h-4 w-4 shrink-0 ${
                          quickGenerateData.predictions?.crowdLevel?.overall === 'Low' ? 'text-emerald-500' :
                          quickGenerateData.predictions?.crowdLevel?.overall === 'High' ? 'text-orange-500' : 'text-amber-500'
                        }`} />
                        <div>
                          <p className="text-xs text-muted-foreground">Crowd</p>
                          <p className={`text-sm font-semibold ${
                            quickGenerateData.predictions?.crowdLevel?.overall === 'Low' ? 'text-emerald-600' :
                            quickGenerateData.predictions?.crowdLevel?.overall === 'High' ? 'text-orange-600' : 'text-amber-600'
                          }`}>{quickGenerateData.predictions?.crowdLevel?.overall || 'Medium'}</p>
                        </div>
                      </div>
                      <div className="flex items-center gap-2.5 p-3 rounded-lg bg-white/60 dark:bg-white/5 border border-rose-100 dark:border-rose-900/30">
                        <Activity className="h-4 w-4 text-rose-500 shrink-0" />
                        <div>
                          <p className="text-xs text-muted-foreground">Peak Hours</p>
                          <p className="text-sm font-semibold">{quickGenerateData.predictions?.crowdLevel?.peakHours || '11am - 2pm'}</p>
                        </div>
                      </div>
                      <div className="flex items-center gap-2.5 p-3 rounded-lg bg-white/60 dark:bg-white/5 border border-rose-100 dark:border-rose-900/30">
                        <Building2 className="h-4 w-4 text-purple-500 shrink-0" />
                        <div>
                          <p className="text-xs text-muted-foreground">Hotels</p>
                          <p className="text-sm font-semibold">{100 - (quickGenerateData.predictions?.hotelOccupancy?.percentage || 65)}% Available</p>
                        </div>
                      </div>
                    </div>
                  </div>
                </div>
            ) : (streamingMode === 'quick' || isSectionExiting('q-overview')) ? (
              <div className={isSectionExiting('q-overview') ? 'animate-skeleton-exit' : undefined}>
                <QuickOverviewSkeleton />
              </div>
            ) : null}

            {/* Predictive Analytics */}
            {quickGenerateData && contentVisible.has('q-analytics') ? (
                <div className="animate-fade-in-up" style={{ animationDelay: '0s', animationFillMode: 'backwards' }}>
                  <div className="flex items-center gap-2 mb-3">
                    <BarChart3 className="h-4 w-4 text-rose-500" />
                    <h3 className="text-sm font-semibold">Predictive Analytics</h3>
                  </div>

                  {/* Weather & Price Row - Same as preference-based */}
                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 mb-3">
                    {/* Weather Forecast */}
                    <div className="rounded-xl border bg-card p-4">
                      <div className="flex items-start justify-between">
                        <div>
                          <p className="text-xs text-muted-foreground mb-1">During Your Trip</p>
                          <p className="text-2xl font-bold">{quickGenerateData.predictions?.weather?.temperature || '28-33°C'}</p>
                          <p className="text-sm text-muted-foreground mt-0.5">{quickGenerateData.predictions?.weather?.condition || 'Partly Cloudy'}</p>
                        </div>
                        <div className={`w-12 h-12 rounded-full flex items-center justify-center ${
                          quickGenerateData.predictions?.weather?.icon === 'sun' ? 'bg-amber-100 dark:bg-amber-900/30' :
                          quickGenerateData.predictions?.weather?.icon === 'cloud-rain' ? 'bg-blue-100 dark:bg-blue-900/30' :
                          'bg-amber-100 dark:bg-amber-900/30'
                        }`}>
                          {quickGenerateData.predictions?.weather?.icon === 'sun' && <Sun className="h-6 w-6 text-amber-500" />}
                          {quickGenerateData.predictions?.weather?.icon === 'cloud-sun' && <CloudSun className="h-6 w-6 text-amber-500" />}
                          {quickGenerateData.predictions?.weather?.icon === 'cloud' && <CloudSun className="h-6 w-6 text-gray-500" />}
                          {quickGenerateData.predictions?.weather?.icon === 'cloud-rain' && <CloudRain className="h-6 w-6 text-blue-500" />}
                          {!quickGenerateData.predictions?.weather?.icon && <CloudSun className="h-6 w-6 text-amber-500" />}
                        </div>
                      </div>
                      <div className="flex items-center gap-4 mt-4 pt-3 border-t">
                        <div className="flex items-center gap-2 px-2.5 py-1.5 rounded-lg bg-muted/50">
                          <CloudRain className="h-4 w-4 text-blue-500" />
                          <span className="text-xs font-medium">{quickGenerateData.predictions?.weather?.rainChance || 30}% rain</span>
                        </div>
                        <div className="flex items-center gap-2 px-2.5 py-1.5 rounded-lg bg-muted/50">
                          <Thermometer className="h-4 w-4 text-rose-500" />
                          <span className="text-xs font-medium">{quickGenerateData.predictions?.weather?.humidity || 75}% humidity</span>
                        </div>
                      </div>
                      {quickGenerateData.predictions?.weather?.summary && (
                        <p className="text-xs text-muted-foreground mt-3">{quickGenerateData.predictions?.weather?.summary}</p>
                      )}
                    </div>

                    {/* Price Trend */}
                    <div className="rounded-xl border bg-card p-4">
                      <div className="flex items-start justify-between">
                        <div>
                          <p className="text-xs text-muted-foreground mb-1">Price for Your Dates</p>
                          <div className="flex items-center gap-1.5">
                            <p className={`text-2xl font-bold ${
                              (quickGenerateData.predictions?.pricing?.percentChange || 0) < 0 ? 'text-emerald-600' : 'text-orange-600'
                            }`}>
                              {(quickGenerateData.predictions?.pricing?.percentChange || 0) > 0 ? '+' : ''}{quickGenerateData.predictions?.pricing?.percentChange || -5}%
                            </p>
                            {(quickGenerateData.predictions?.pricing?.percentChange || 0) < 0 ? (
                              <TrendingDown className="h-5 w-5 text-emerald-500" />
                            ) : (
                              <TrendingUp className="h-5 w-5 text-orange-500" />
                            )}
                          </div>
                          <p className="text-sm text-muted-foreground mt-0.5">
                            {(quickGenerateData.predictions?.pricing?.percentChange || 0) < 0 ? 'below' : 'above'} average
                          </p>
                        </div>
                        <div className={`w-12 h-12 rounded-full flex items-center justify-center ${
                          (quickGenerateData.predictions?.pricing?.percentChange || 0) < 0 ? 'bg-emerald-100 dark:bg-emerald-900/30' : 'bg-orange-100 dark:bg-orange-900/30'
                        }`}>
                          <DollarSign className={`h-6 w-6 ${
                            (quickGenerateData.predictions?.pricing?.percentChange || 0) < 0 ? 'text-emerald-500' : 'text-orange-500'
                          }`} />
                        </div>
                      </div>
                      <div className="flex items-center gap-3 mt-4 pt-3 border-t">
                        <div className="flex items-center gap-2 px-2.5 py-1.5 rounded-lg bg-muted/50">
                          <span className="text-xs">Hotels</span>
                          <span className={`text-xs font-semibold ${
                            (quickGenerateData.predictions?.pricing?.percentChange || 0) < 0 ? 'text-emerald-600' : 'text-orange-600'
                          }`}>
                            {(quickGenerateData.predictions?.pricing?.percentChange || 0) > 0 ? '+' : ''}{quickGenerateData.predictions?.pricing?.percentChange || -5}%
                          </span>
                        </div>
                        <div className="flex items-center gap-2 px-2.5 py-1.5 rounded-lg bg-muted/50">
                          <span className="text-xs">Activities</span>
                          <span className="text-xs font-semibold text-emerald-600">-5%</span>
                        </div>
                      </div>
                      {quickGenerateData.predictions?.pricing?.summary && (
                        <p className="text-xs text-muted-foreground mt-3">{quickGenerateData.predictions?.pricing?.summary}</p>
                      )}
                    </div>
                  </div>

                  {/* Analytics Grid - Same as preference-based */}
                  <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
                    {/* Hotel Occupancy */}
                    <div className="rounded-xl border bg-card p-4">
                      <div className="flex items-center gap-2 mb-3">
                        <div className="w-8 h-8 rounded-lg bg-blue-100 dark:bg-blue-900/30 flex items-center justify-center">
                          <Plane className="h-4 w-4 text-blue-500" />
                        </div>
                        <span className="text-sm font-medium">Hotel Occupancy</span>
                      </div>
                      <div className="flex items-baseline gap-1.5 mb-3">
                        <span className="text-2xl font-bold">{quickGenerateData.predictions?.hotelOccupancy?.percentage || 65}%</span>
                        <span className="text-xs text-muted-foreground">booked</span>
                      </div>
                      <div className="h-2 bg-muted rounded-full overflow-hidden mb-3">
                        <div className="h-full rounded-full bg-blue-500 transition-all duration-500" style={{ width: `${quickGenerateData.predictions?.hotelOccupancy?.percentage || 65}%` }} />
                      </div>
                      <p className="text-xs text-muted-foreground">{quickGenerateData.predictions?.hotelOccupancy?.summary || 'Good availability expected'}</p>
                    </div>

                    {/* Crowd Level - Bar Chart */}
                    <div className="rounded-xl border bg-card p-4">
                      <div className="flex items-center justify-between mb-3">
                        <div className="flex items-center gap-2">
                          <div className="w-8 h-8 rounded-lg bg-orange-100 dark:bg-orange-900/30 flex items-center justify-center">
                            <Users className="h-4 w-4 text-orange-500" />
                          </div>
                          <span className="text-sm font-medium">Crowd Level</span>
                        </div>
                        <Badge variant="secondary" className="text-xs">Hourly</Badge>
                      </div>
                      <ChartContainer
                        config={{
                          crowd: { label: "Crowded", color: "#f97316" }
                        }}
                        className="h-[72px] w-full"
                      >
                        <BarChart
                          data={(quickGenerateData.predictions?.crowdLevel?.data || [
                            { time: '6am', level: 15 },
                            { time: '8am', level: 35 },
                            { time: '10am', level: 55 },
                            { time: '12pm', level: 75 },
                            { time: '2pm', level: 70 },
                            { time: '4pm', level: 60 },
                            { time: '6pm', level: 45 },
                            { time: '9pm', level: 25 }
                          ]).map((d: any) => ({ time: d.time, crowd: d.level }))}
                          margin={{ top: 0, right: 0, bottom: 0, left: 0 }}
                        >
                          <XAxis dataKey="time" hide />
                          <YAxis hide domain={[0, 100]} />
                          <ChartTooltip
                            content={
                              <ChartTooltipContent
                                labelFormatter={(label) => `${label}`}
                                formatter={(value) => [`${value}%`, "Crowded"]}
                              />
                            }
                          />
                          <Bar dataKey="crowd" fill="var(--color-crowd)" radius={[3, 3, 0, 0]} />
                        </BarChart>
                      </ChartContainer>
                      <p className="text-xs text-muted-foreground mt-3">{quickGenerateData.predictions?.crowdLevel?.summary || `Peak ${quickGenerateData.predictions?.crowdLevel?.peakHours || '11am-2pm'}. Best early morning.`}</p>
                    </div>

                    {/* Traffic Chart */}
                    <div className="rounded-xl border bg-card p-4">
                      <div className="flex items-center justify-between mb-3">
                        <div className="flex items-center gap-2">
                          <div className="w-8 h-8 rounded-lg bg-rose-100 dark:bg-rose-900/30 flex items-center justify-center">
                            <Car className="h-4 w-4 text-rose-500" />
                          </div>
                          <span className="text-sm font-medium">Traffic</span>
                        </div>
                        <Badge className="text-xs bg-rose-500 hover:bg-rose-600">{quickGenerateData.predictions?.traffic?.peakDelay || '15-25 min'}</Badge>
                      </div>
                      <ChartContainer
                        config={{
                          traffic: { label: "Congestion", color: "#f43f5e" }
                        }}
                        className="h-[72px] w-full"
                      >
                        <LineChart
                          data={(quickGenerateData.predictions?.traffic?.data || [
                            { time: '6am', level: 20 },
                            { time: '8am', level: 75 },
                            { time: '10am', level: 45 },
                            { time: '12pm', level: 50 },
                            { time: '2pm', level: 40 },
                            { time: '4pm', level: 55 },
                            { time: '6pm', level: 80 },
                            { time: '9pm', level: 30 }
                          ]).map((d: any) => ({ time: d.time, traffic: d.level }))}
                          margin={{ top: 5, right: 5, bottom: 0, left: 5 }}
                        >
                          <XAxis dataKey="time" hide />
                          <YAxis hide domain={[0, 100]} />
                          <ChartTooltip
                            content={
                              <ChartTooltipContent
                                labelFormatter={(label) => `${label}`}
                                formatter={(value) => [`${value}%`, "Congestion"]}
                              />
                            }
                          />
                          <Line type="monotone" dataKey="traffic" stroke="var(--color-traffic)" strokeWidth={2} dot={false} />
                        </LineChart>
                      </ChartContainer>
                      <p className="text-xs text-muted-foreground mt-3">{quickGenerateData.predictions?.traffic?.summary || 'Avoid rush hours 8-9am and 5-7pm'}</p>
                    </div>
                  </div>
                </div>

            ) : (streamingMode === 'quick' || isSectionExiting('q-analytics')) ? (
              <div className={isSectionExiting('q-analytics') ? 'animate-skeleton-exit' : undefined}>
                <PredictiveAnalyticsSkeleton delay="0.2s" />
              </div>
            ) : null}

            {/* Quick Tips */}
            {quickGenerateData && contentVisible.has('q-tips') ? (
                <div className="rounded-xl border bg-gradient-to-br from-rose-50 to-transparent dark:from-rose-950/20 dark:to-transparent p-4 animate-fade-in-up" style={{ animationDelay: '0s', animationFillMode: 'backwards' }}>
                  <div className="flex items-center gap-2 mb-4">
                    <div className="w-8 h-8 rounded-lg bg-rose-100 dark:bg-rose-900/30 flex items-center justify-center">
                      <Lightbulb className="h-4 w-4 text-rose-500" />
                    </div>
                    <h3 className="text-sm font-semibold">Quick Tips</h3>
                  </div>
                  <div className="grid sm:grid-cols-2 gap-3">
                    {(quickGenerateData.quickTips || []).map((tip: any, index: number) => (
                      <div key={index} className="flex items-start gap-3 p-4 rounded-lg bg-background/60 border hover:bg-background/80 transition-colors">
                        <div className="w-8 h-8 rounded-full bg-gradient-to-br from-rose-500 to-rose-600 flex items-center justify-center shrink-0 shadow-sm">
                          <span className="text-xs text-white font-semibold">{index + 1}</span>
                        </div>
                        <div className="flex-1 min-w-0">
                          <p className="text-sm font-semibold mb-1">{tip.title}</p>
                          <p className="text-xs text-muted-foreground">{tip.description}</p>
                        </div>
                      </div>
                    ))}
                  </div>
                </div>
            ) : (streamingMode === 'quick' || isSectionExiting('q-tips')) ? (
              <div className={isSectionExiting('q-tips') ? 'animate-skeleton-exit' : undefined}>
                <QuickTipsSkeleton />
              </div>
            ) : null}

            {/* Preference-based Plan View (per-section progressive reveal) */}

            {/* Plan Selection */}
            {generatedPlan && !quickGenerateData && contentVisible.has('f-plans') ? (
            <div className="animate-fade-in-up" style={{ animationDelay: '0s', animationFillMode: 'backwards' }}>
              <div className="flex items-center gap-2 mb-1">
                <Sparkles className="h-4 w-4 text-rose-500" />
                <h3 className="text-sm font-semibold">Choose Your Plan</h3>
              </div>
              {streamingMode !== null && (
                <p className="text-xs text-muted-foreground mb-3 flex items-center gap-1.5">
                  <Loader2 className="h-3 w-3 animate-spin text-rose-400" />
                  Plan selection will be available once generation is complete
                </p>
              )}
              {streamingMode === null && <div className="mb-2" />}
              <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
                {generatedPlan?.plans && Object.entries(generatedPlan.plans).map(([planName, planData]: [string, any], index: number) => {
                  const isSelected = selectedPlan === planName
                  const isRecommended = index === 1

                  const crowdText = planData?.crowdLevel || 'Medium Crowd'
                  const crowdLower = crowdText.toLowerCase()
                  const getCrowdConfig = () => {
                    if (crowdLower.includes('low')) return { label: 'Low', color: 'text-emerald-600', bg: 'bg-emerald-50 dark:bg-emerald-950/30', dot: 'bg-emerald-500' }
                    if (crowdLower.includes('high')) return { label: 'High', color: 'text-orange-600', bg: 'bg-orange-50 dark:bg-orange-950/30', dot: 'bg-orange-500' }
                    return { label: 'Medium', color: 'text-blue-600', bg: 'bg-blue-50 dark:bg-blue-950/30', dot: 'bg-blue-500' }
                  }
                  const crowd = getCrowdConfig()

                  // Get traveler preference matches for this plan
                  const travelerMatches = getTravelerPreferenceMatch(planData, planName)
                  const prefersCount = travelerMatches.filter(m => m.prefers).length
                  const allPrefer = prefersCount === travelerMatches.length
                  const avgScore = Math.round(travelerMatches.reduce((sum, m) => sum + m.score, 0) / travelerMatches.length)

                  return (
                    <div
                      key={planName}
                      onClick={() => streamingMode === null && handleSelectPlan(planName)}
                      className={`relative rounded-xl border bg-card p-5 transition-all duration-200 h-full flex flex-col animate-fade-in-scale ${
                        streamingMode !== null
                          ? 'opacity-80 cursor-not-allowed'
                          : 'cursor-pointer'
                      } ${
                        isSelected
                          ? 'border-rose-500 shadow-md ring-2 ring-rose-500/20'
                          : streamingMode === null ? 'border-border hover:border-rose-300 hover:shadow-sm' : 'border-border'
                      }`}
                      style={{ animationDelay: `${0.15 + index * 0.1}s`, animationFillMode: 'backwards' }}
                    >
                      {isRecommended && (
                        <div className="absolute -top-2.5 left-1/2 -translate-x-1/2 z-10">
                          <Badge className="text-xs px-2.5 py-0.5 bg-gradient-to-r from-rose-500 to-rose-600 text-white border-0 shadow-sm">
                            <Sparkles className="h-3 w-3 mr-1" />
                            Recommended
                          </Badge>
                        </div>
                      )}

                      <div className="flex items-start justify-between gap-2 mb-3">
                        <h4 className="font-semibold text-base leading-tight">{planName}</h4>
                        <div className={`shrink-0 w-5 h-5 rounded-full border-2 flex items-center justify-center transition-colors ${
                          isSelected ? 'border-rose-500 bg-rose-500' : 'border-muted-foreground/30'
                        }`}>
                          {isSelected && (
                            <CheckCircle2 className="w-3 h-3 text-white" />
                          )}
                        </div>
                      </div>

                      <p className="text-sm text-muted-foreground mb-4 line-clamp-2 min-h-[40px] leading-relaxed flex-grow">
                        {planData?.description || 'Personalized travel plan'}
                      </p>

                      <div className="mb-4">
                        <span className="text-2xl font-bold text-foreground">
                          {planData?.pricePerPerson?.replace('/ person', '').replace('/person', '').trim() || 'RM 1,000'}
                        </span>
                        <span className="text-sm text-muted-foreground ml-1">/ person</span>
                      </div>

                      <div className="flex items-center gap-2 flex-wrap mb-3">
                        <div className={`inline-flex items-center gap-1.5 px-3 py-1.5 rounded-full text-xs font-medium ${crowd.bg} ${crowd.color}`}>
                          <span className={`w-1.5 h-1.5 rounded-full ${crowd.dot}`} />
                          {crowd.label} Crowd
                        </div>
                        <div className={`inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-xs font-medium ${
                          avgScore >= 80 ? 'bg-emerald-100 dark:bg-emerald-900/30 text-emerald-600' :
                          avgScore >= 60 ? 'bg-blue-100 dark:bg-blue-900/30 text-blue-600' :
                          'bg-orange-100 dark:bg-orange-900/30 text-orange-600'
                        }`}>
                          <Activity className="h-3 w-3" />
                          {avgScore}% match
                        </div>
                        {allPrefer && (
                          <div className="inline-flex items-center gap-1 px-2 py-1 rounded-full text-xs font-medium bg-emerald-100 dark:bg-emerald-900/30 text-emerald-600">
                            <CheckCircle2 className="h-3 w-3" />
                            All prefer
                          </div>
                        )}
                      </div>

                      {/* Traveler Preference Labels - Compact View */}
                      <div className="pt-3 border-t">
                        <div className="flex items-center justify-between mb-2">
                          <p className="text-xs text-muted-foreground">Traveler match:</p>
                          <div className="flex items-center gap-1">
                            <span className="text-xs text-emerald-600 font-medium">{prefersCount} prefer</span>
                            {travelerMatches.length - prefersCount > 0 && (
                              <>
                                <span className="text-xs text-muted-foreground">·</span>
                                <span className="text-xs text-orange-600 font-medium">{travelerMatches.length - prefersCount} less ideal</span>
                              </>
                            )}
                          </div>
                        </div>
                        <div className="flex items-center gap-1.5 flex-wrap">
                          {travelerMatches.map((match, idx) => {
                            const colors = ['bg-rose-500', 'bg-blue-500', 'bg-emerald-500', 'bg-amber-500', 'bg-purple-500']
                            const mainReason = match.reasons[0]?.text || (match.prefers ? 'Good fit' : 'Less ideal')
                            return (
                              <Popover key={idx}>
                                <PopoverTrigger asChild>
                                  <button
                                    className={`flex items-center gap-1.5 px-2 py-1 rounded-full text-xs transition-colors ${
                                      match.prefers
                                        ? 'bg-emerald-50 dark:bg-emerald-950/30 hover:bg-emerald-100 dark:hover:bg-emerald-900/40'
                                        : 'bg-orange-50 dark:bg-orange-950/30 hover:bg-orange-100 dark:hover:bg-orange-900/40'
                                    }`}
                                    onClick={(e) => e.stopPropagation()}
                                  >
                                    <div className={`w-5 h-5 rounded-full ${colors[idx % colors.length]} flex items-center justify-center text-white text-[10px] font-semibold ring-2 ${match.prefers ? 'ring-emerald-400' : 'ring-orange-400'}`}>
                                      {match.name.charAt(0).toUpperCase()}
                                    </div>
                                    <span className={`font-medium ${match.prefers ? 'text-emerald-700 dark:text-emerald-400' : 'text-orange-700 dark:text-orange-400'}`}>
                                      {match.score}%
                                    </span>
                                  </button>
                                </PopoverTrigger>
                                <PopoverContent
                                  className="w-56 p-3 font-[family-name:var(--font-geist-sans)]"
                                  align="center"
                                  onClick={(e) => e.stopPropagation()}
                                >
                                  <div className="space-y-2">
                                    <div className="flex items-center justify-between">
                                      <div className="flex items-center gap-2">
                                        <div className={`w-6 h-6 rounded-full ${colors[idx % colors.length]} flex items-center justify-center text-white text-xs font-semibold`}>
                                          {match.name.charAt(0).toUpperCase()}
                                        </div>
                                        <span className="text-sm font-semibold">{match.name}</span>
                                      </div>
                                      {match.prefers ? (
                                        <CheckCircle2 className="h-5 w-5 text-emerald-500" />
                                      ) : (
                                        <X className="h-5 w-5 text-orange-500" />
                                      )}
                                    </div>
                                    <div className={`text-center py-2 rounded-lg ${match.prefers ? 'bg-emerald-50 dark:bg-emerald-950/30' : 'bg-orange-50 dark:bg-orange-950/30'}`}>
                                      <span className={`text-2xl font-bold ${match.prefers ? 'text-emerald-600' : 'text-orange-600'}`}>
                                        {match.score}%
                                      </span>
                                      <p className={`text-xs ${match.prefers ? 'text-emerald-600' : 'text-orange-600'}`}>
                                        {match.prefers ? 'Prefers this plan' : 'Less ideal'}
                                      </p>
                                    </div>
                                    <div>
                                      <p className="text-xs text-muted-foreground mb-1.5">Match details:</p>
                                      <div className="flex flex-wrap gap-1">
                                        {match.reasons.map((reason, rIdx) => (
                                          <span
                                            key={rIdx}
                                            className={`text-xs px-2 py-0.5 rounded-full ${
                                              reason.positive
                                                ? 'bg-emerald-100 dark:bg-emerald-900/50 text-emerald-700 dark:text-emerald-400'
                                                : 'bg-orange-100 dark:bg-orange-900/50 text-orange-700 dark:text-orange-400'
                                            }`}
                                          >
                                            {reason.text}
                                          </span>
                                        ))}
                                      </div>
                                    </div>
                                  </div>
                                </PopoverContent>
                              </Popover>
                            )
                          })}
                        </div>
                      </div>
                    </div>
                  )
                })}
              </div>
            </div>

            ) : (streamingMode === 'full' || isSectionExiting('f-plans')) ? (
              <div className={isSectionExiting('f-plans') ? 'animate-skeleton-exit' : undefined}>
                <PlanSelectionSkeleton />
              </div>
            ) : null}

            {/* Plan Details */}
            {generatedPlan && !quickGenerateData && contentVisible.has('f-details') && generatedPlan?.plans?.[selectedPlan] ? (
              <div className="animate-fade-in-up" style={{ animationDelay: '0s', animationFillMode: 'backwards' }}>
                <div className="flex items-center gap-2 mb-3">
                  <Info className="h-4 w-4 text-rose-500" />
                  <h3 className="text-sm font-semibold">Plan Details</h3>
                </div>
                <div className="grid sm:grid-cols-2 gap-3">
                  {/* Key Features */}
                  <div className="rounded-xl border bg-card p-4">
                    <div className="flex items-center gap-2 mb-3">
                      <div className="w-8 h-8 rounded-lg bg-rose-100 dark:bg-rose-900/30 flex items-center justify-center">
                        <Sparkles className="h-4 w-4 text-rose-500" />
                      </div>
                      <p className="text-sm font-semibold">Key Features</p>
                    </div>
                    <div className="space-y-2.5">
                      {(generatedPlan.plans[selectedPlan].keyFeatures || []).map((feature: string, idx: number) => (
                        <div key={idx} className="flex items-start gap-2.5 p-2 rounded-lg bg-muted/50 hover:bg-muted transition-colors">
                          <CheckCircle2 className="h-4 w-4 text-rose-500 mt-0.5 shrink-0" />
                          <span className="text-sm">{feature}</span>
                        </div>
                      ))}
                    </div>
                  </div>

                  {/* Benefits */}
                  <div className="rounded-xl border bg-card p-4">
                    <div className="flex items-center gap-2 mb-3">
                      <div className="w-8 h-8 rounded-lg bg-emerald-100 dark:bg-emerald-900/30 flex items-center justify-center">
                        <Leaf className="h-4 w-4 text-emerald-500" />
                      </div>
                      <p className="text-sm font-semibold">Benefits</p>
                    </div>
                    <div className="space-y-2.5">
                      {(generatedPlan.plans[selectedPlan].benefits || []).map((benefit: string, idx: number) => (
                        <div key={idx} className="flex items-start gap-2.5 p-2 rounded-lg bg-muted/50 hover:bg-muted transition-colors">
                          <CheckCircle2 className="h-4 w-4 text-emerald-500 mt-0.5 shrink-0" />
                          <span className="text-sm">{benefit}</span>
                        </div>
                      ))}
                    </div>
                  </div>
                </div>
              </div>
            ) : (streamingMode === 'full' || isSectionExiting('f-details')) ? (
              <div className={isSectionExiting('f-details') ? 'animate-skeleton-exit' : undefined}>
                <PlanDetailsSkeleton />
              </div>
            ) : null}

            {/* Best Travel Window / Optimal Period */}
            {generatedPlan && !quickGenerateData && contentVisible.has('f-window') ? (
                <div className="animate-fade-in-up" style={{ animationDelay: '0s', animationFillMode: 'backwards' }}>
                  <div className="flex items-center gap-2 mb-3">
                    <Clock className="h-4 w-4 text-rose-500" />
                    <h3 className="text-sm font-semibold">Best Travel Window</h3>
                  </div>
                  <div className="grid grid-cols-3 gap-3">
                    {/* Optimal Period */}
                    <div className="rounded-xl border bg-card p-4 text-center">
                      <div className="w-10 h-10 rounded-full bg-rose-100 dark:bg-rose-900/30 flex items-center justify-center mx-auto mb-3">
                        <Calendar className="h-5 w-5 text-rose-500" />
                      </div>
                      <p className="text-xs text-muted-foreground mb-1">Optimal Period</p>
                      <p className="text-sm font-semibold">{bestWindow.optimalPeriod}</p>
                    </div>

                    {/* Price Advantage */}
                    <div className="rounded-xl border bg-card p-4 text-center">
                      <div className={`w-10 h-10 rounded-full flex items-center justify-center mx-auto mb-3 ${
                        bestWindow.priceDirection === 'higher'
                          ? 'bg-orange-100 dark:bg-orange-900/30'
                          : 'bg-emerald-100 dark:bg-emerald-900/30'
                      }`}>
                        {bestWindow.priceDirection === 'higher' ? (
                          <TrendingUp className="h-5 w-5 text-orange-500" />
                        ) : (
                          <TrendingDown className="h-5 w-5 text-emerald-500" />
                        )}
                      </div>
                      <p className="text-xs text-muted-foreground mb-1">Price</p>
                      <p className={`text-sm font-semibold ${
                        bestWindow.priceDirection === 'higher' ? 'text-orange-600' : 'text-emerald-600'
                      }`}>{bestWindow.priceAdvantage}</p>
                    </div>

                    {/* Crowd Level */}
                    <div className="rounded-xl border bg-card p-4 text-center">
                      <div className="w-10 h-10 rounded-full bg-blue-100 dark:bg-blue-900/30 flex items-center justify-center mx-auto mb-3">
                        <Users className="h-5 w-5 text-blue-500" />
                      </div>
                      <p className="text-xs text-muted-foreground mb-1">Crowd</p>
                      <p className="text-sm font-semibold">{bestWindow.crowdLevel}</p>
                    </div>
                  </div>
                </div>
            ) : (streamingMode === 'full' || isSectionExiting('f-window')) ? (
              <div className={isSectionExiting('f-window') ? 'animate-skeleton-exit' : undefined}>
                <BestWindowSkeleton />
              </div>
            ) : null}

            {/* Predictive Analytics */}
            {generatedPlan && !quickGenerateData && contentVisible.has('f-analytics') ? (
                <div className="animate-fade-in-up" style={{ animationDelay: '0s', animationFillMode: 'backwards' }}>
                  <div className="flex items-center gap-2 mb-3">
                    <BarChart3 className="h-4 w-4 text-rose-500" />
                    <h3 className="text-sm font-semibold">Predictive Analytics</h3>
                  </div>

                  {/* Weather & Price Row */}
                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 mb-3">
                    {/* Weather Forecast - Dynamic */}
                    <div className="rounded-xl border bg-card p-4">
                      <div className="flex items-start justify-between">
                        <div>
                          <p className="text-xs text-muted-foreground mb-1">During Your Trip</p>
                          <p className="text-2xl font-bold">{analytics.weather?.temperature || '28-33°C'}</p>
                          <p className="text-sm text-muted-foreground mt-0.5">{analytics.weather?.condition || 'Partly Cloudy'}</p>
                        </div>
                        <div className={`w-12 h-12 rounded-full flex items-center justify-center ${
                          analytics.weather?.icon === 'sun' ? 'bg-amber-100 dark:bg-amber-900/30' :
                          analytics.weather?.icon === 'cloud-rain' || analytics.weather?.icon === 'cloud-storm' ? 'bg-blue-100 dark:bg-blue-900/30' :
                          analytics.weather?.icon === 'cloud' ? 'bg-gray-100 dark:bg-gray-800/30' :
                          'bg-amber-100 dark:bg-amber-900/30'
                        }`}>
                          {analytics.weather?.icon === 'sun' && <Sun className="h-6 w-6 text-amber-500" />}
                          {analytics.weather?.icon === 'cloud-sun' && <CloudSun className="h-6 w-6 text-amber-500" />}
                          {analytics.weather?.icon === 'cloud' && <CloudSun className="h-6 w-6 text-gray-500" />}
                          {(analytics.weather?.icon === 'cloud-rain' || analytics.weather?.icon === 'cloud-storm') && <CloudRain className="h-6 w-6 text-blue-500" />}
                          {!analytics.weather?.icon && <CloudSun className="h-6 w-6 text-amber-500" />}
                        </div>
                      </div>
                      <div className="flex items-center gap-4 mt-4 pt-3 border-t">
                        <div className="flex items-center gap-2 px-2.5 py-1.5 rounded-lg bg-muted/50">
                          <CloudRain className="h-4 w-4 text-blue-500" />
                          <span className="text-xs font-medium">{analytics.weather?.rainChance || 30}% rain</span>
                        </div>
                        <div className="flex items-center gap-2 px-2.5 py-1.5 rounded-lg bg-muted/50">
                          <Thermometer className="h-4 w-4 text-rose-500" />
                          <span className="text-xs font-medium">{analytics.weather?.humidity || 75}% humidity</span>
                        </div>
                      </div>
                      {analytics.weather?.summary && (
                        <p className="text-xs text-muted-foreground mt-3">{analytics.weather.summary}</p>
                      )}
                    </div>

                    {/* Price Trend - Dynamic */}
                    <div className="rounded-xl border bg-card p-4">
                      <div className="flex items-start justify-between">
                        <div>
                          <p className="text-xs text-muted-foreground mb-1">Price for Your Dates</p>
                          <div className="flex items-center gap-1.5">
                            <p className={`text-2xl font-bold ${
                              (analytics.priceIndex?.percentChange || 0) < 0 ? 'text-emerald-600' : 'text-orange-600'
                            }`}>
                              {(analytics.priceIndex?.percentChange || 0) > 0 ? '+' : ''}{analytics.priceIndex?.percentChange || -10}%
                            </p>
                            {(analytics.priceIndex?.trend === 'down' || (analytics.priceIndex?.percentChange || 0) < 0) ? (
                              <TrendingDown className="h-5 w-5 text-emerald-500" />
                            ) : (analytics.priceIndex?.trend === 'up' || (analytics.priceIndex?.percentChange || 0) > 0) ? (
                              <TrendingUp className="h-5 w-5 text-orange-500" />
                            ) : (
                              <Activity className="h-5 w-5 text-gray-500" />
                            )}
                          </div>
                          <p className="text-sm text-muted-foreground mt-0.5">
                            {(analytics.priceIndex?.percentChange || 0) < 0 ? 'below' : 'above'} average
                          </p>
                        </div>
                        <div className={`w-12 h-12 rounded-full flex items-center justify-center ${
                          (analytics.priceIndex?.percentChange || 0) < 0
                            ? 'bg-emerald-100 dark:bg-emerald-900/30'
                            : 'bg-orange-100 dark:bg-orange-900/30'
                        }`}>
                          <DollarSign className={`h-6 w-6 ${
                            (analytics.priceIndex?.percentChange || 0) < 0 ? 'text-emerald-500' : 'text-orange-500'
                          }`} />
                        </div>
                      </div>
                      <div className="flex items-center gap-3 mt-4 pt-3 border-t">
                        <div className="flex items-center gap-2 px-2.5 py-1.5 rounded-lg bg-muted/50">
                          <span className="text-xs">Hotels</span>
                          <span className={`text-xs font-semibold ${
                            (analytics.priceIndex?.hotels || 0) < 0 ? 'text-emerald-600' : 'text-orange-600'
                          }`}>
                            {(analytics.priceIndex?.hotels || 0) > 0 ? '+' : ''}{analytics.priceIndex?.hotels || -12}%
                          </span>
                        </div>
                        <div className="flex items-center gap-2 px-2.5 py-1.5 rounded-lg bg-muted/50">
                          <span className="text-xs">Flights</span>
                          <span className={`text-xs font-semibold ${
                            (analytics.priceIndex?.flights || 0) < 0 ? 'text-emerald-600' : 'text-orange-600'
                          }`}>
                            {(analytics.priceIndex?.flights || 0) > 0 ? '+' : ''}{analytics.priceIndex?.flights || -8}%
                          </span>
                        </div>
                        <div className="flex items-center gap-2 px-2.5 py-1.5 rounded-lg bg-muted/50">
                          <span className="text-xs">Activities</span>
                          <span className={`text-xs font-semibold ${
                            (analytics.priceIndex?.activities || 0) < 0 ? 'text-emerald-600' : 'text-orange-600'
                          }`}>
                            {(analytics.priceIndex?.activities || 0) > 0 ? '+' : ''}{analytics.priceIndex?.activities || -5}%
                          </span>
                        </div>
                      </div>
                      {analytics.priceIndex?.summary && (
                        <p className="text-xs text-muted-foreground mt-3">{analytics.priceIndex.summary}</p>
                      )}
                    </div>
                  </div>

                  {/* Analytics Grid */}
                  <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">

                    {/* Hotel Occupancy - Dynamic */}
                    <div className="rounded-xl border bg-card p-4">
                      <div className="flex items-center gap-2 mb-3">
                        <div className="w-8 h-8 rounded-lg bg-blue-100 dark:bg-blue-900/30 flex items-center justify-center">
                          <Plane className="h-4 w-4 text-blue-500" />
                        </div>
                        <span className="text-sm font-medium">Hotel Occupancy</span>
                      </div>
                      <div className="flex items-baseline gap-1.5 mb-3">
                        <span className="text-2xl font-bold">{analytics.hotelOccupancy?.percentage || 65}%</span>
                        <span className="text-xs text-muted-foreground">booked</span>
                      </div>
                      <div className="h-2 bg-muted rounded-full overflow-hidden mb-3">
                        <div className="h-full rounded-full bg-blue-500 transition-all duration-500" style={{ width: `${analytics.hotelOccupancy?.percentage || 65}%` }} />
                      </div>
                      <p className="text-xs text-muted-foreground">{analytics.hotelOccupancy?.summary || 'Good availability expected'}</p>
                    </div>

                    {/* Attraction Crowd - Bar Chart with Dynamic Data */}
                    <div className="rounded-xl border bg-card p-4">
                      <div className="flex items-center justify-between mb-3">
                        <div className="flex items-center gap-2">
                          <div className="w-8 h-8 rounded-lg bg-orange-100 dark:bg-orange-900/30 flex items-center justify-center">
                            <Users className="h-4 w-4 text-orange-500" />
                          </div>
                          <span className="text-sm font-medium">Crowd Level</span>
                        </div>
                        <Badge variant="secondary" className="text-xs">Hourly</Badge>
                      </div>
                      <ChartContainer
                        config={{
                          crowd: { label: "Crowded", color: "#f97316" }
                        }}
                        className="h-[72px] w-full"
                      >
                        <BarChart
                          data={(analytics.crowdLevel?.data || [
                            { time: '6am', level: 15 },
                            { time: '8am', level: 35 },
                            { time: '10am', level: 55 },
                            { time: '12pm', level: 75 },
                            { time: '2pm', level: 70 },
                            { time: '4pm', level: 60 },
                            { time: '6pm', level: 45 },
                            { time: '9pm', level: 25 }
                          ]).map((d: any) => ({ time: d.time, crowd: d.level }))}
                          margin={{ top: 0, right: 0, bottom: 0, left: 0 }}
                        >
                          <XAxis dataKey="time" hide />
                          <YAxis hide domain={[0, 100]} />
                          <ChartTooltip
                            content={
                              <ChartTooltipContent
                                labelFormatter={(label) => `${label}`}
                                formatter={(value) => [`${value}%`, "Crowded"]}
                              />
                            }
                          />
                          <Bar dataKey="crowd" fill="var(--color-crowd)" radius={[3, 3, 0, 0]} />
                        </BarChart>
                      </ChartContainer>
                      <p className="text-xs text-muted-foreground mt-3">{analytics.crowdLevel?.summary || `Peak ${analytics.crowdLevel?.peakTime || '11am-2pm'}. Best before 9am`}</p>
                    </div>

                    {/* Traffic - Line Chart with Dynamic Data */}
                    <div className="rounded-xl border bg-card p-4">
                      <div className="flex items-center justify-between mb-3">
                        <div className="flex items-center gap-2">
                          <div className="w-8 h-8 rounded-lg bg-rose-100 dark:bg-rose-900/30 flex items-center justify-center">
                            <Activity className="h-4 w-4 text-rose-500" />
                          </div>
                          <span className="text-sm font-medium">Traffic</span>
                        </div>
                        <Badge className="text-xs bg-rose-500 hover:bg-rose-600">{analytics.traffic?.peakDelay || '15-25 min'}</Badge>
                      </div>
                      <ChartContainer
                        config={{
                          traffic: { label: "Congestion", color: "#f43f5e" }
                        }}
                        className="h-[72px] w-full"
                      >
                        <LineChart
                          data={(analytics.traffic?.data || [
                            { time: '6am', level: 20 },
                            { time: '8am', level: 75 },
                            { time: '10am', level: 45 },
                            { time: '12pm', level: 50 },
                            { time: '2pm', level: 40 },
                            { time: '4pm', level: 55 },
                            { time: '6pm', level: 80 },
                            { time: '9pm', level: 30 }
                          ]).map((d: any) => ({ time: d.time, traffic: d.level }))}
                          margin={{ top: 5, right: 5, bottom: 0, left: 5 }}
                        >
                          <XAxis dataKey="time" hide />
                          <YAxis hide domain={[0, 100]} />
                          <ChartTooltip
                            content={
                              <ChartTooltipContent
                                labelFormatter={(label) => `${label}`}
                                formatter={(value) => [`${value}%`, "Congestion"]}
                              />
                            }
                          />
                          <Line type="monotone" dataKey="traffic" stroke="var(--color-traffic)" strokeWidth={2} dot={false} />
                        </LineChart>
                      </ChartContainer>
                      <p className="text-xs text-muted-foreground mt-3">{analytics.traffic?.summary || 'Avoid rush hours 8-9am and 5-7pm'}</p>
                    </div>

                  </div>
                </div>
            ) : (streamingMode === 'full' || isSectionExiting('f-analytics')) ? (
              <div className={isSectionExiting('f-analytics') ? 'animate-skeleton-exit' : undefined}>
                <PredictiveAnalyticsSkeleton delay="0.4s" />
              </div>
            ) : null}

            {/* Sustainability Dashboard */}
            {generatedPlan && !quickGenerateData && contentVisible.has('f-sustainability') ? (
                <div className="rounded-xl border bg-gradient-to-br from-rose-50 to-transparent dark:from-rose-950/20 dark:to-transparent p-4 animate-fade-in-up" style={{ animationDelay: '0s', animationFillMode: 'backwards' }}>
                  <div className="flex items-center gap-2 mb-4">
                    <div className="w-8 h-8 rounded-lg bg-rose-100 dark:bg-rose-900/30 flex items-center justify-center">
                      <Leaf className="h-4 w-4 text-rose-500" />
                    </div>
                    <h3 className="text-sm font-semibold">Sustainability Dashboard</h3>
                  </div>
                  <div className="grid sm:grid-cols-2 gap-4">
                    {/* Resource Impact */}
                    <div>
                      <h4 className="text-xs font-medium text-muted-foreground mb-2">Resource Impact</h4>
                      <div className="space-y-2">
                        {[
                          { label: 'Water Usage', value: sustainability.waterUsage },
                          { label: 'Waste Generation', value: sustainability.wasteGeneration },
                          { label: 'Energy Consumption', value: sustainability.energyConsumption }
                        ].map((item) => (
                          <div key={item.label} className="p-3 bg-background/60 rounded-lg border hover:bg-background/80 transition-colors">
                            <div className="flex justify-between text-sm mb-2">
                              <span className="text-muted-foreground">{item.label}</span>
                              <span className={`font-semibold ${
                                item.value?.level === 'Low' ? 'text-emerald-600' :
                                item.value?.level === 'High' ? 'text-orange-600' :
                                'text-blue-600'
                              }`}>{item.value?.level || 'Medium'}</span>
                            </div>
                            <div className="h-2 bg-muted rounded-full overflow-hidden">
                              <div
                                className={`h-full rounded-full transition-all duration-500 ${
                                  item.value?.level === 'Low' ? 'bg-emerald-500' :
                                  item.value?.level === 'High' ? 'bg-orange-500' :
                                  'bg-blue-500'
                                }`}
                                style={{ width: `${item.value?.value || 50}%` }}
                              />
                            </div>
                          </div>
                        ))}
                      </div>
                    </div>

                    {/* Community Impact */}
                    <div>
                      <h4 className="text-xs font-medium text-muted-foreground mb-2">Community Impact</h4>
                      <div className="space-y-2">
                        {[
                          { label: 'Local Business Support', value: sustainability.localBusinessSupport || sustainability.localBusiness || 'Medium', isPositiveGood: true },
                          { label: 'Infrastructure Pressure', value: sustainability.infrastructurePressure || 'Medium', isPositiveGood: false },
                          { label: 'Cultural Preservation', value: sustainability.culturalPreservation || 'Positive', isPositiveGood: true }
                        ].map((item) => {
                          // Convert text value to percentage
                          const getPercentage = () => {
                            if (item.value === 'High' || item.value === 'Positive') return 85
                            if (item.value === 'Low' || item.value === 'Negative') return 25
                            return 50 // Medium/Neutral
                          }
                          const percentage = getPercentage()

                          // Determine color based on whether high/positive is good or bad
                          const getColor = () => {
                            if (item.isPositiveGood) {
                              // High/Positive = good (green), Low/Negative = bad (orange)
                              if (item.value === 'High' || item.value === 'Positive') return { text: 'text-emerald-600', bar: 'bg-emerald-500' }
                              if (item.value === 'Low' || item.value === 'Negative') return { text: 'text-orange-600', bar: 'bg-orange-500' }
                            } else {
                              // Infrastructure Pressure: Low = good (green), High = bad (orange)
                              if (item.value === 'Low') return { text: 'text-emerald-600', bar: 'bg-emerald-500' }
                              if (item.value === 'High') return { text: 'text-orange-600', bar: 'bg-orange-500' }
                            }
                            return { text: 'text-blue-600', bar: 'bg-blue-500' } // Medium/Neutral
                          }
                          const colors = getColor()

                          return (
                            <div key={item.label} className="p-3 bg-background/60 rounded-lg border hover:bg-background/80 transition-colors">
                              <div className="flex justify-between text-sm mb-2">
                                <span className="text-muted-foreground">{item.label}</span>
                                <span className={`font-semibold ${colors.text}`}>{item.value}</span>
                              </div>
                              <div className="h-2 bg-muted rounded-full overflow-hidden">
                                <div
                                  className={`h-full rounded-full transition-all duration-500 ${colors.bar}`}
                                  style={{ width: `${percentage}%` }}
                                />
                              </div>
                            </div>
                          )
                        })}
                      </div>
                    </div>
                  </div>

                  {/* Sustainability Summary */}
                  <div className="mt-4 space-y-3">
                    {/* Overall Score & AI Summary */}
                    <div className="p-4 bg-background/60 rounded-lg border">
                      <div className="flex flex-wrap items-center gap-2 mb-3">
                        <Recycle className="h-4 w-4 text-emerald-500" />
                        <h4 className="text-sm font-semibold">Sustainability Summary</h4>
                        <Badge variant="outline" className="text-[10px] border-teal-400 text-teal-600 bg-teal-50 dark:bg-teal-950/30">
                          <Brain className="h-3 w-3 mr-1" />Predictive Analysis
                        </Badge>
                      </div>

                      {/* Score Ring + Summary Text */}
                      <div className="flex flex-col items-center sm:flex-row sm:items-start gap-3 sm:gap-4 mb-4">
                        <div className="relative flex items-center justify-center shrink-0">
                          <svg className="w-16 h-16 -rotate-90" viewBox="0 0 64 64">
                            <circle cx="32" cy="32" r="28" fill="none" stroke="currentColor" className="text-muted/20" strokeWidth="5" />
                            <circle cx="32" cy="32" r="28" fill="none"
                              className={
                                (sustainability.overallScore || 65) >= 75 ? 'text-emerald-500' :
                                (sustainability.overallScore || 65) >= 50 ? 'text-blue-500' :
                                'text-orange-500'
                              }
                              strokeWidth="5"
                              strokeLinecap="round"
                              strokeDasharray={`${((sustainability.overallScore || 65) / 100) * 175.9} 175.9`}
                              stroke="currentColor"
                            />
                          </svg>
                          <span className={`absolute text-sm font-bold ${
                            (sustainability.overallScore || 65) >= 75 ? 'text-emerald-600' :
                            (sustainability.overallScore || 65) >= 50 ? 'text-blue-600' :
                            'text-orange-600'
                          }`}>{sustainability.overallScore || 65}</span>
                        </div>
                        <div className="flex-1 min-w-0 text-center sm:text-left">
                          <div className="flex items-center justify-center sm:justify-start gap-2 mb-1.5">
                            <Badge variant="outline" className={`text-xs ${
                              sustainability.overallLabel === 'Excellent' ? 'border-emerald-500 text-emerald-600 bg-emerald-50 dark:bg-emerald-950/30' :
                              sustainability.overallLabel === 'Good' ? 'border-blue-500 text-blue-600 bg-blue-50 dark:bg-blue-950/30' :
                              sustainability.overallLabel === 'Moderate' ? 'border-amber-500 text-amber-600 bg-amber-50 dark:bg-amber-950/30' :
                              'border-orange-500 text-orange-600 bg-orange-50 dark:bg-orange-950/30'
                            }`}>
                              {sustainability.overallLabel || 'Moderate'}
                            </Badge>
                          </div>
                          <p className="text-sm text-muted-foreground leading-relaxed">
                            {sustainability.summary || 'This plan has a moderate sustainability profile. Consider adjusting your travel dates or activities for a lower environmental footprint.'}
                          </p>
                        </div>
                      </div>

                      {/* Carbon Footprint */}
                      {sustainability.carbonFootprint && (
                        <div className="p-3 rounded-lg bg-muted/30 border">
                          <div className="flex items-center gap-2 mb-2">
                            <Footprints className="h-3.5 w-3.5 text-muted-foreground" />
                            <span className="text-sm font-semibold">Carbon Footprint</span>
                            <Badge variant="outline" className={`text-xs ml-auto ${
                              sustainability.carbonFootprint.level === 'Low' ? 'border-emerald-400 text-emerald-600' :
                              sustainability.carbonFootprint.level === 'High' ? 'border-orange-400 text-orange-600' :
                              'border-blue-400 text-blue-600'
                            }`}>
                              {sustainability.carbonFootprint.level}
                            </Badge>
                          </div>
                          <div className="flex flex-wrap items-center justify-between gap-1 text-sm text-muted-foreground">
                            <span>{sustainability.carbonFootprint.estimate}</span>
                            <span className={
                              sustainability.carbonFootprint.comparison?.includes('lower') ? 'text-emerald-600 font-medium' : 'text-orange-600 font-medium'
                            }>{sustainability.carbonFootprint.comparison}</span>
                          </div>
                        </div>
                      )}

                      {/* Travel Date Assessment */}
                      {sustainability.travelDateAssessment && (
                        <div className="pt-3 mt-3 border-t">
                          <div className="flex items-center gap-2 mb-2">
                            <Calendar className="h-4 w-4 text-blue-500" />
                            <span className="text-sm font-semibold">Travel Date Assessment</span>
                          </div>
                          <div className="grid sm:grid-cols-2 gap-2">
                            <div className={`p-2.5 rounded-lg border ${
                              sustainability.travelDateAssessment.currentDates?.suitability === 'Suitable' ? 'bg-emerald-50/50 border-emerald-200 dark:bg-emerald-950/20 dark:border-emerald-800' :
                              sustainability.travelDateAssessment.currentDates?.suitability === 'Not Ideal' ? 'bg-orange-50/50 border-orange-200 dark:bg-orange-950/20 dark:border-orange-800' :
                              'bg-amber-50/50 border-amber-200 dark:bg-amber-950/20 dark:border-amber-800'
                            }`}>
                              <div className="flex items-center gap-2 mb-1">
                                {sustainability.travelDateAssessment.currentDates?.suitability === 'Suitable' ? (
                                  <CalendarCheck className="h-3.5 w-3.5 text-emerald-500" />
                                ) : (
                                  <CalendarX className="h-3.5 w-3.5 text-orange-500" />
                                )}
                                <span className="text-xs font-semibold">Your Selected Dates</span>
                                <Badge variant="outline" className={`text-[10px] ml-auto ${
                                  sustainability.travelDateAssessment.currentDates?.suitability === 'Suitable' ? 'border-emerald-400 text-emerald-600' :
                                  sustainability.travelDateAssessment.currentDates?.suitability === 'Not Ideal' ? 'border-orange-400 text-orange-600' :
                                  'border-amber-400 text-amber-600'
                                }`}>
                                  {sustainability.travelDateAssessment.currentDates?.suitability || 'Moderate'}
                                </Badge>
                              </div>
                              <p className="text-xs text-muted-foreground">
                                {sustainability.travelDateAssessment.currentDates?.reason || 'Standard tourist period'}
                              </p>
                            </div>

                            <div className="p-2.5 rounded-lg border bg-emerald-50/50 border-emerald-200 dark:bg-emerald-950/20 dark:border-emerald-800">
                              <div className="flex items-center gap-2 mb-1">
                                <CalendarCheck className="h-3.5 w-3.5 text-emerald-500" />
                                <span className="text-xs font-semibold">Recommended Period</span>
                                <Badge variant="outline" className="text-[10px] ml-auto border-emerald-400 text-emerald-600">
                                  Better
                                </Badge>
                              </div>
                              <p className="text-xs font-medium text-emerald-700 dark:text-emerald-400 mb-0.5">
                                {sustainability.travelDateAssessment.recommendedDates?.period || 'Off-peak season'}
                              </p>
                              <p className="text-xs text-muted-foreground">
                                {sustainability.travelDateAssessment.recommendedDates?.reason || 'Lower crowds and reduced environmental impact'}
                              </p>
                            </div>
                          </div>

                          {sustainability.travelDateAssessment.peakSeasons && sustainability.travelDateAssessment.peakSeasons.length > 0 && (
                            <div className="mt-2 p-2.5 rounded-lg bg-orange-50/50 dark:bg-orange-950/20 border border-orange-200 dark:border-orange-800">
                              <div className="flex items-center gap-2 mb-1">
                                <AlertTriangle className="h-3 w-3 text-orange-500" />
                                <span className="text-xs font-semibold text-orange-700 dark:text-orange-400">Peak Seasons to Avoid</span>
                              </div>
                              <div className="flex flex-wrap gap-1.5">
                                {sustainability.travelDateAssessment.peakSeasons.map((season: string, idx: number) => (
                                  <Badge key={idx} variant="outline" className="text-[10px] border-orange-300 text-orange-600 bg-orange-100/50 dark:bg-orange-900/20">
                                    {season}
                                  </Badge>
                                ))}
                              </div>
                            </div>
                          )}
                        </div>
                      )}

                      {/* Eco-Friendly Recommendations */}
                      {sustainability.recommendations && sustainability.recommendations.length > 0 && (
                        <div className="pt-3 mt-3 border-t">
                          <div className="flex items-center gap-2 mb-2">
                            <Lightbulb className="h-4 w-4 text-amber-500" />
                            <span className="text-sm font-semibold">Eco-Friendly Recommendations</span>
                          </div>
                          <div className="grid sm:grid-cols-2 gap-2">
                            {sustainability.recommendations.map((rec: { tip?: string; impact?: string; category?: string } | string, idx: number) => {
                              const tip = typeof rec === 'string' ? rec : rec.tip
                              const impact = typeof rec === 'string' ? 'Medium' : (rec.impact || 'Medium')
                              const category = typeof rec === 'string' ? 'Activity' : (rec.category || 'Activity')

                              const getCategoryIcon = () => {
                                switch (category) {
                                  case 'Transport': return <Car className="h-3 w-3 text-blue-500 mt-0.5 shrink-0" />
                                  case 'Food': return <Utensils className="h-3 w-3 text-orange-500 mt-0.5 shrink-0" />
                                  case 'Accommodation': return <BedDouble className="h-3 w-3 text-purple-500 mt-0.5 shrink-0" />
                                  case 'Waste': return <Recycle className="h-3 w-3 text-emerald-500 mt-0.5 shrink-0" />
                                  default: return <TreePine className="h-3 w-3 text-teal-500 mt-0.5 shrink-0" />
                                }
                              }

                              return (
                                <div key={idx} className="flex items-start gap-2 p-2 rounded-lg bg-emerald-50/50 dark:bg-emerald-950/20 border border-emerald-100 dark:border-emerald-900/30">
                                  {getCategoryIcon()}
                                  <div className="flex-1 min-w-0">
                                    <span className="text-xs text-muted-foreground leading-relaxed block">{tip}</span>
                                    <div className="flex items-center gap-1.5 mt-1">
                                      <Badge variant="outline" className={`text-[10px] px-1.5 py-0 ${
                                        impact === 'High' ? 'border-emerald-400 text-emerald-600' :
                                        impact === 'Low' ? 'border-gray-300 text-gray-500' :
                                        'border-blue-400 text-blue-600'
                                      }`}>
                                        {impact} Impact
                                      </Badge>
                                      <span className="text-[10px] text-muted-foreground">{category}</span>
                                    </div>
                                  </div>
                                </div>
                              )
                            })}
                          </div>
                        </div>
                      )}
                    </div>
                  </div>
                </div>
            ) : (streamingMode === 'full' || isSectionExiting('f-sustainability')) ? (
              <div className={isSectionExiting('f-sustainability') ? 'animate-skeleton-exit' : undefined}>
                <SustainabilitySkeleton />
              </div>
            ) : null}

            {/* Predictions & Alerts */}
            {generatedPlan && !quickGenerateData && contentVisible.has('f-alerts') ? (
                <div className="animate-fade-in-up" style={{ animationDelay: '0s', animationFillMode: 'backwards' }}>
                  <div className="flex items-center gap-2 mb-3">
                    <Bell className="h-4 w-4 text-rose-500" />
                    <h3 className="text-sm font-semibold">Predictions & Alerts</h3>
                  </div>

                  <div className="grid sm:grid-cols-2 gap-3">
                    {/* Crowd Alert - Show first one only */}
                    {(alerts.crowd || [])[0] && (
                      <div className="rounded-xl border bg-card p-4">
                        <div className="flex items-start gap-3">
                          <div className="w-10 h-10 rounded-lg bg-amber-100 dark:bg-amber-900/30 flex items-center justify-center shrink-0">
                            <Users className="h-5 w-5 text-amber-500" />
                          </div>
                          <div className="flex-1 min-w-0">
                            <div className="flex items-center gap-2 mb-1 flex-wrap">
                              <span className="font-semibold text-sm">{(alerts.crowd || [])[0].title}</span>
                              <Badge className={`text-xs ${
                                (alerts.crowd || [])[0].levelType === 'danger' ? 'bg-red-500 hover:bg-red-600' :
                                (alerts.crowd || [])[0].levelType === 'warning' ? 'bg-amber-500 hover:bg-amber-600' :
                                (alerts.crowd || [])[0].levelType === 'success' ? 'bg-emerald-500 hover:bg-emerald-600' :
                                'bg-blue-500 hover:bg-blue-600'
                              }`}>{(alerts.crowd || [])[0].level}</Badge>
                            </div>
                            <p className="text-xs text-muted-foreground mb-1">{(alerts.crowd || [])[0].location} · {(alerts.crowd || [])[0].time}</p>
                            {(alerts.crowd || [])[0].description && <p className="text-xs text-muted-foreground mb-2">{(alerts.crowd || [])[0].description}</p>}
                            <div className="flex items-start gap-1.5 p-2 rounded-lg bg-muted/50">
                              <Brain className="h-3.5 w-3.5 text-rose-500 mt-0.5 shrink-0" />
                              <p className="text-xs text-muted-foreground">{(alerts.crowd || [])[0].suggestion}</p>
                            </div>
                          </div>
                        </div>
                      </div>
                    )}

                    {/* Weather Alert - Show first one only */}
                    {(alerts.weather || [])[0] && (
                      <div className="rounded-xl border bg-card p-4">
                        <div className="flex items-start gap-3">
                          <div className="w-10 h-10 rounded-lg bg-blue-100 dark:bg-blue-900/30 flex items-center justify-center shrink-0">
                            <CloudRain className="h-5 w-5 text-blue-500" />
                          </div>
                          <div className="flex-1 min-w-0">
                            <div className="flex items-center gap-2 mb-1 flex-wrap">
                              <span className="font-semibold text-sm">{(alerts.weather || [])[0].title}</span>
                              <Badge className={`text-xs ${
                                (alerts.weather || [])[0].levelType === 'danger' ? 'bg-red-500 hover:bg-red-600' :
                                (alerts.weather || [])[0].levelType === 'warning' ? 'bg-amber-500 hover:bg-amber-600' :
                                (alerts.weather || [])[0].levelType === 'success' ? 'bg-emerald-500 hover:bg-emerald-600' :
                                'bg-blue-500 hover:bg-blue-600'
                              }`}>{(alerts.weather || [])[0].level}</Badge>
                            </div>
                            <p className="text-xs text-muted-foreground mb-1">{(alerts.weather || [])[0].location} · {(alerts.weather || [])[0].time}</p>
                            {(alerts.weather || [])[0].description && <p className="text-xs text-muted-foreground mb-2">{(alerts.weather || [])[0].description}</p>}
                            <div className="flex items-start gap-1.5 p-2 rounded-lg bg-muted/50">
                              <Brain className="h-3.5 w-3.5 text-rose-500 mt-0.5 shrink-0" />
                              <p className="text-xs text-muted-foreground">{(alerts.weather || [])[0].suggestion}</p>
                            </div>
                          </div>
                        </div>
                      </div>
                    )}

                    {/* Price Alert - Show first one only */}
                    {(alerts.price || [])[0] && (
                      <div className="rounded-xl border bg-card p-4">
                        <div className="flex items-start gap-3">
                          <div className="w-10 h-10 rounded-lg bg-emerald-100 dark:bg-emerald-900/30 flex items-center justify-center shrink-0">
                            <Tag className="h-5 w-5 text-emerald-500" />
                          </div>
                          <div className="flex-1 min-w-0">
                            <div className="flex items-center gap-2 mb-1 flex-wrap">
                              <span className="font-semibold text-sm">{(alerts.price || [])[0].title}</span>
                              <Badge className={`text-xs ${
                                (alerts.price || [])[0].levelType === 'danger' ? 'bg-red-500 hover:bg-red-600' :
                                (alerts.price || [])[0].levelType === 'warning' ? 'bg-amber-500 hover:bg-amber-600' :
                                (alerts.price || [])[0].levelType === 'success' ? 'bg-emerald-500 hover:bg-emerald-600' :
                                'bg-blue-500 hover:bg-blue-600'
                              }`}>{(alerts.price || [])[0].level}</Badge>
                            </div>
                            <p className="text-xs text-muted-foreground mb-1">{(alerts.price || [])[0].location} · {(alerts.price || [])[0].time}</p>
                            {(alerts.price || [])[0].description && <p className="text-xs text-muted-foreground mb-2">{(alerts.price || [])[0].description}</p>}
                            <div className="flex items-start gap-1.5 p-2 rounded-lg bg-muted/50">
                              <Brain className="h-3.5 w-3.5 text-rose-500 mt-0.5 shrink-0" />
                              <p className="text-xs text-muted-foreground">{(alerts.price || [])[0].suggestion}</p>
                            </div>
                          </div>
                        </div>
                      </div>
                    )}

                    {/* Safety Alert - Show first one only */}
                    {(alerts.safety || [])[0] && (
                      <div className="rounded-xl border bg-card p-4">
                        <div className="flex items-start gap-3">
                          <div className="w-10 h-10 rounded-lg bg-rose-100 dark:bg-rose-900/30 flex items-center justify-center shrink-0">
                            <Shield className="h-5 w-5 text-rose-500" />
                          </div>
                          <div className="flex-1 min-w-0">
                            <div className="flex items-center gap-2 mb-1 flex-wrap">
                              <span className="font-semibold text-sm">{(alerts.safety || [])[0].title}</span>
                              <Badge className={`text-xs ${
                                (alerts.safety || [])[0].levelType === 'danger' ? 'bg-red-500 hover:bg-red-600' :
                                (alerts.safety || [])[0].levelType === 'warning' ? 'bg-rose-500 hover:bg-rose-600' :
                                (alerts.safety || [])[0].levelType === 'success' ? 'bg-emerald-500 hover:bg-emerald-600' :
                                'bg-blue-500 hover:bg-blue-600'
                              }`}>{(alerts.safety || [])[0].level}</Badge>
                            </div>
                            <p className="text-xs text-muted-foreground mb-1">{(alerts.safety || [])[0].location} · {(alerts.safety || [])[0].time}</p>
                            {(alerts.safety || [])[0].description && <p className="text-xs text-muted-foreground mb-2">{(alerts.safety || [])[0].description}</p>}
                            <div className="flex items-start gap-1.5 p-2 rounded-lg bg-muted/50">
                              <Brain className="h-3.5 w-3.5 text-rose-500 mt-0.5 shrink-0" />
                              <p className="text-xs text-muted-foreground">{(alerts.safety || [])[0].suggestion}</p>
                            </div>
                          </div>
                        </div>
                      </div>
                    )}
                  </div>
                </div>
            ) : (streamingMode === 'full' || isSectionExiting('f-alerts')) ? (
              <div className={isSectionExiting('f-alerts') ? 'animate-skeleton-exit' : undefined}>
                <AlertsSkeleton />
              </div>
            ) : null}

            {/* Personalized Suggestions */}
            {generatedPlan && !quickGenerateData && contentVisible.has('f-suggestions') ? (
                <div className="rounded-xl border bg-gradient-to-br from-rose-50 to-transparent dark:from-rose-950/20 dark:to-transparent p-4 animate-fade-in-up" style={{ animationDelay: '0s', animationFillMode: 'backwards' }}>
                  <div className="flex items-center gap-2 mb-4">
                    <div className="w-8 h-8 rounded-lg bg-rose-100 dark:bg-rose-900/30 flex items-center justify-center">
                      <Lightbulb className="h-4 w-4 text-rose-500" />
                    </div>
                    <h3 className="text-sm font-semibold">Personalized Suggestions</h3>
                  </div>
                  <div className="grid sm:grid-cols-2 gap-3">
                    {(suggestions || []).map((suggestion: any, index: number) => {
                      // Handle both old string format and new {title, description} format
                      const isObject = typeof suggestion === 'object' && suggestion !== null
                      const title = isObject ? suggestion.title : `Tip ${index + 1}`
                      const description = isObject ? suggestion.description : suggestion

                      return (
                        <div key={index} className="flex items-start gap-3 p-4 rounded-lg bg-background/60 border hover:bg-background/80 transition-colors">
                          <div className="w-8 h-8 rounded-full bg-gradient-to-br from-rose-500 to-rose-600 flex items-center justify-center shrink-0 shadow-sm">
                            <span className="text-xs text-white font-semibold">{index + 1}</span>
                          </div>
                          <div className="flex-1 min-w-0">
                            <p className="text-sm font-semibold mb-1">{title}</p>
                            <p className="text-xs text-muted-foreground">{description}</p>
                          </div>
                        </div>
                      )
                    })}
                  </div>
                </div>
            ) : (streamingMode === 'full' || isSectionExiting('f-suggestions')) ? (
              <div className={isSectionExiting('f-suggestions') ? 'animate-skeleton-exit' : undefined}>
                <SuggestionsSkeleton delay="0.7s" />
              </div>
            ) : null}


            {/* Save Confirmation Dialog */}
            <Dialog open={showSaveDialog} onOpenChange={setShowSaveDialog}>
              <DialogContent className="w-[calc(100%-2rem)] sm:max-w-sm p-0 overflow-hidden font-[family-name:var(--font-geist-sans)]">
                <DialogHeader className="sr-only">
                  <DialogTitle>Save Travel Plan</DialogTitle>
                  <DialogDescription>Confirm saving your travel plan and redirect to dashboard</DialogDescription>
                </DialogHeader>
                <div className="p-6 text-center">
                  <div className="relative mx-auto w-16 h-16 mb-4">
                    <div className="relative w-16 h-16 rounded-full bg-gradient-to-br from-rose-400 to-rose-500 flex items-center justify-center shadow-lg">
                      <Sparkles className="h-8 w-8 text-white" />
                    </div>
                  </div>

                  <h3 className="text-lg font-semibold mb-2">Save this travel plan?</h3>
                  <p className="text-sm text-muted-foreground mb-4">
                    Your plan for <span className="font-medium text-foreground">{tripData.destination}</span> will be saved and you will be redirected to the dashboard.
                  </p>

                  <div className="inline-flex items-center gap-2 px-3 py-1.5 rounded-full bg-rose-50 dark:bg-rose-950/30 mb-6">
                    <MapPinIcon className="h-3.5 w-3.5 text-rose-500" />
                    <span className="text-sm font-medium">{tripData.destination}</span>
                  </div>

                  <div className="flex gap-3">
                    <Button
                      variant="outline"
                      className="flex-1"
                      onClick={() => setShowSaveDialog(false)}
                      disabled={isSaving}
                    >
                      Cancel
                    </Button>
                    <Button
                      className="flex-1 bg-rose-500 hover:bg-rose-600"
                      onClick={handleSavePlan}
                      disabled={isSaving}
                    >
                      {isSaving ? 'Saving...' : 'Save & Continue'}
                    </Button>
                  </div>
                </div>
              </DialogContent>
            </Dialog>
          </div>
        )}
      </div>

      {/* Scroll to Top Button with progress ring - shown on results step after scrolling */}
      {currentStep === 'results' && scrollProgress > 0.05 && (
        <button
          onClick={() => window.scrollTo({ top: 0, behavior: 'smooth' })}
          className="fixed bottom-14 right-3 sm:bottom-16 sm:right-4 z-50 w-11 h-11 rounded-full bg-white hover:bg-rose-50 shadow-lg shadow-black/10 flex items-center justify-center transition-all duration-300 hover:scale-110 animate-in fade-in zoom-in-75"
          aria-label="Scroll to top"
        >
          <svg className="absolute inset-0 w-11 h-11 -rotate-90" viewBox="0 0 44 44">
            <circle cx="22" cy="22" r="20" fill="none" stroke="#fecdd3" strokeWidth="2.5" />
            <circle
              cx="22" cy="22" r="20" fill="none"
              stroke="#f43f5e" strokeWidth="2.5"
              strokeLinecap="round"
              strokeDasharray={2 * Math.PI * 20}
              strokeDashoffset={2 * Math.PI * 20 * (1 - scrollProgress)}
              className="transition-[stroke-dashoffset] duration-100"
            />
          </svg>
          <ArrowUp className="h-4 w-4 text-rose-500 relative z-10" />
        </button>
      )}

      {/* Group 5 Label */}
      <GroupLabel group={5} />
    </PageLayout>
  )
}
