import { useState, useEffect, useMemo, useRef, useCallback } from 'react'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { useNavigate, useLocation } from 'react-router-dom'
import toast from 'react-hot-toast'
import ReactQuill from 'react-quill'
import 'react-quill/dist/quill.snow.css'
import {
  registerAboutPageImageBlot,
  buildAboutImageStyle,
  type AboutImageLayoutAlign,
  type AboutImageLayoutWidth,
  type AboutImageTextWrap,
} from '../lib/aboutQuillImageBlot'

import { authApi } from '../lib/auth'
import { useA11yDialog } from '../lib/useA11yDialog'
import { adminApi, adminDiscountCodesApi, carouselApi, faqApi, userProfilesApi, legalPagesApi, settingsApi, managersApi, checklistApi, pointsApi, taxRatesApi, whatsappGroupsApi, ticketsApi, securityEventsApi } from '../lib/api'
import { supabase } from '../lib/supabase'
import { geocodeCity, geocodeLocation } from '../lib/geocoding'
import { normalizePostcode, toTitleCase } from '../lib/textFormat'
import { z } from 'zod'
import { eventImagesApi } from '../lib/eventImagesApi'
import { eventHostsApi } from '../lib/eventHostsApi'
import { locationLibraryApi, type LocationLibraryImage } from '../lib/locationLibraryApi'
import type { Event, CarouselItem, CarouselPlacement, CarouselOrientation, FAQ, UserProfile, EventChecklistItem, EventChecklistCompletion, TaxRate, WhatsAppGroup, SecurityEvent } from '../types/database'
import RedemptionsManagement from '../components/RedemptionsManagement'
import AdminCityLeadApplications from '../components/AdminCityLeadApplications'
import AdminShopManagement from '../components/AdminShopManagement'
import DiscountCodesManagement from '../components/DiscountCodesManagement'
import AdminLocationVotesPanel from '../components/AdminLocationVotesPanel'
import AdminCityLeadSourcesPanel from '../components/AdminCityLeadSourcesPanel'
import AdminLocationLibraryPanel from '../components/AdminLocationLibraryPanel'
import AdminPartnerLogosPanel from '../components/AdminPartnerLogosPanel'
import AdminEventHostsPanel from '../components/AdminEventHostsPanel'
import AdminRingInventoryPanel from '../components/AdminRingInventoryPanel'
import AdminNdaPanel from '../components/AdminNdaPanel'
import AdminContractsPanel from '../components/AdminContractsPanel'
import AdminMeditationPanel from '../components/AdminMeditationPanel'
import AdminYaugaTokenPanel from '../components/AdminYaugaTokenPanel'
import AdminPromoteModal from '../components/AdminPromoteModal'
import { promoteApi, type PromotionRecord } from '../lib/promoteApi'
import { canPromoteEvent } from '../lib/promoteStock'
import AdminOrdersPanel from '../components/AdminOrdersPanel'
import MeditationAccessSetting from '../components/MeditationAccessSetting'
import AdminAnalyticsSettings from '../components/AdminAnalyticsSettings'
import AdminChatbotSettings from '../components/AdminChatbotSettings'
import YaugaLoader from '../components/YaugaLoader'
import ListPagination from '../components/ListPagination'
import { useBrandName } from '../lib/useBrandName'
import { useLegalEmail } from '../lib/useLegalEmail'
import { isAdminEventCheckInButtonVisible } from '../lib/eventCheckInWindow'
import { printEventAttendeeList } from '../lib/printEventAttendeeList'
import { parseEventProgram } from '../lib/eventProgram'
import { parseEventTimeline, timelineToTextarea, textareaToTimeline } from '../lib/eventTimeline'
import { formatEventDateTimeForInput, parseEventDateTimeLocalForStorage } from '../lib/eventDateTime'
import {
  parseVitalityChallengesSetting,
  serializeVitalityChallengesSetting,
} from '../lib/vitality/challengeConfig'
import {
  parseVerifiedMetricPointsSetting,
  serializeVerifiedMetricPointsSetting,
  VERIFIED_METRIC_LABELS,
  VERIFIED_METRIC_KEYS,
} from '../lib/vitality/verifiedMetricPoints'
import {
  parseVitalityDataPartners,
  serializeVitalityDataPartners,
  type VitalityDataPartner,
} from '../lib/vitality/dataPartners'
import {
  parseVitalityYaugaRingSetting,
  serializeVitalityYaugaRingSetting,
} from '../lib/vitality/yaugaRingConfig'
import {
  parseRingMetricGuidance,
  serializeRingMetricGuidance,
  RING_GUIDANCE_METRIC_LABELS,
  type RingGuidanceMetricKey,
} from '../lib/vitality/ringMetricGuidance'
import { vitalityApi } from '../lib/vitalityApi'
import type { VitalityHealthDevice } from '../lib/vitality/healthDevices'

registerAboutPageImageBlot()

const EARLY_INCENTIVE_CODE_CHARS = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789'
function randomEarlyIncentiveCode8(): string {
  const bytes = new Uint8Array(8)
  crypto.getRandomValues(bytes)
  let out = ''
  for (let i = 0; i < bytes.length; i++) out += EARLY_INCENTIVE_CODE_CHARS[bytes[i] % EARLY_INCENTIVE_CODE_CHARS.length]
  return out
}

const eventSchema = z.object({
  name: z.string().min(1, 'Name is required'),
  city: z.string().min(1, 'City is required'),
  country: z.string().min(1, 'Country is required'),
  currency: z.enum(['GBP', 'USD'], { errorMap: () => ({ message: 'Currency must be GBP or USD' }) }),
  show_venue: z.boolean(),
  location: z.string().nullable().optional(),
  event_date: z.string().min(1, 'Event date is required'),
  details: z.string().nullable().optional(),
  event_summary: z.string().max(320, 'Short description must be 320 characters or less').nullable().optional(),
  event_what_to_bring: z.string().nullable().optional(),
  event_refund: z.string().nullable().optional(),
  event_duration: z.number().min(0.1, 'Duration must be at least 0.1 hours').nullable().optional(),
  min_target: z.number().min(1, 'Minimum target must be at least 1'),
  max_tickets: z.number().min(1).nullable().optional(),
  price_pence: z.number().min(0, 'Price must be non-negative'),
  points_awarded: z.number().min(0, 'Points must be non-negative'),
  status: z.enum(['draft', 'collecting_interest', 'open', 'closed', 'completed', 'sold_out']),
  admin_email: z.string().email('Valid email is required'),
  latitude: z.number().nullable().optional(),
  longitude: z.number().nullable().optional(),
  event_type: z.enum(['physical', 'hybrid']).optional(),
  hybrid_link: z.string().nullable().optional(),
  hybrid_details: z.string().nullable().optional(),
  hybrid_price_pence: z.number().min(0).nullable().optional(),
  event_program: z.enum(['yauga_haus', 'ritual_room', 'run_club']).optional(),
})

export type AdminPageProps = {
  eventEditor?: 'create' | 'edit'
  editEventId?: string
}

function getAdminEventEditorFromPath(pathname: string): {
  eventEditor?: 'create' | 'edit'
  editEventId?: string
} {
  const path = pathname.replace(/\/$/, '')
  if (path === '/admin/events/create') return { eventEditor: 'create' }
  const editMatch = /^\/admin\/events\/edit\/([^/]+)$/.exec(path)
  if (editMatch?.[1]) return { eventEditor: 'edit', editEventId: editMatch[1] }
  return {}
}

export default function AdminPage({ eventEditor: eventEditorProp, editEventId: editEventIdProp }: AdminPageProps = {}) {
  const navigate = useNavigate()
  const routeLocation = useLocation()
  const pathEditor = getAdminEventEditorFromPath(routeLocation.pathname)
  const eventEditor = eventEditorProp ?? pathEditor.eventEditor
  const editEventId = editEventIdProp ?? pathEditor.editEventId
  const { legalEmail } = useLegalEmail()
  const queryClient = useQueryClient()
  const { brandName } = useBrandName()
  const editFormRef = useRef<HTMLDivElement>(null)
  const selectedEventPanelRef = useRef<HTMLDivElement>(null)
  const [activeTab, setActiveTab] = useState<
    'events' | 'reporting' | 'users' | 'legal' | 'loyalty' | 'redemptions' | 'shop' | 'orders' | 'discount-codes' | 'settings' | 'monitoring' | 'city-leads' | 'yauga-token'
  >('events')
  const [mobileMenuOpen, setMobileMenuOpen] = useState(false)
  const [editingChecklistItem, setEditingChecklistItem] = useState<EventChecklistItem | null>(null)
  const [showChecklistItemForm, setShowChecklistItemForm] = useState(false)
  const [checklistItemFormData, setChecklistItemFormData] = useState({ item_text: '', display_order: 0 })
  const [showChecklistModal, setShowChecklistModal] = useState(false)
  const [eventToOpen, setEventToOpen] = useState<Event | null>(null)
  const [checklistCheckedItems, setChecklistCheckedItems] = useState<Set<string>>(new Set())
  const [showEarlyIncentiveModal, setShowEarlyIncentiveModal] = useState(false)
  const [eventPendingOpen, setEventPendingOpen] = useState<Event | null>(null)
  const [earlyIncentiveStep, setEarlyIncentiveStep] = useState<'prompt' | 'form'>('prompt')
  const [earlyIncentiveForm, setEarlyIncentiveForm] = useState({ numberOfBookings: '', discountPercent: '' })
  const [confirmModal, setConfirmModal] = useState<{
    show: boolean
    title: string
    message: string
    confirmText?: string
    cancelText?: string
    onConfirm: () => void
    confirmButtonClass?: string
  } | null>(null)
  const [testBookingDelete, setTestBookingDelete] = useState<{
    event: Event
    step: 'ask' | 'email'
    email: string
  } | null>(null)
  const [regenerateEventModal, setRegenerateEventModal] = useState<{
    event: Event
    step: 'message-choice' | 'message-input' | 'confirm'
    includeMessage: boolean
    message: string
    isSending: boolean
  } | null>(null)
  const [editingFAQ, setEditingFAQ] = useState<FAQ | null>(null)
  const [showFAQForm, setShowFAQForm] = useState(false)
  const [faqFormData, setFAQFormData] = useState({
    question: '',
    answer: '',
    display_order: 0,
    is_active: true,
  })
  const [legalPageType, setLegalPageType] = useState<'privacy' | 'terms' | 'cookies' | 'event_requirements' | 'about' | null>(null)
  const [legalPageContent, setLegalPageContent] = useState('')
  const [uploadingAboutImage, setUploadingAboutImage] = useState(false)
  const legalQuillRef = useRef<ReactQuill | null>(null)
  const aboutImageInsertIndexRef = useRef(0)
  const [aboutImageLayoutOpen, setAboutImageLayoutOpen] = useState<{
    url: string
    alt: string
    width: AboutImageLayoutWidth
    align: AboutImageLayoutAlign
    tight: boolean
    wrap: AboutImageTextWrap
  } | null>(null)
  const [carouselImageFile, setCarouselImageFile] = useState<File | null>(null)
  const [carouselImagePreview, setCarouselImagePreview] = useState<string>('')
  const [uploadingImage, setUploadingImage] = useState(false)
  const [showBulkUploadModal, setShowBulkUploadModal] = useState(false)
  const [bulkUploadFile, setBulkUploadFile] = useState<File | null>(null)
  const [bulkUploadIsProcessing, setBulkUploadIsProcessing] = useState(false)
  const [bulkUploadResults, setBulkUploadResults] = useState<Array<{
    row: number
    status: 'success' | 'error' | 'skipped'
    message: string
    eventName?: string
  }>>([])
  const [bulkUploadProgress, setBulkUploadProgress] = useState<{ current: number; total: number } | null>(null)
  const [editingEvent, setEditingEvent] = useState<Event | null>(null)
  const [promoteEvent, setPromoteEvent] = useState<Event | null>(null)
  const [selectedEvent, setSelectedEvent] = useState<Event | null>(null)
  const [viewMode, setViewMode] = useState<'class-list' | 'attendees' | 'revenue'>('class-list')
  const [editingCarouselItem, setEditingCarouselItem] = useState<CarouselItem | null>(null)
  const [showCarouselForm, setShowCarouselForm] = useState(false)
  const [carouselFormData, setCarouselFormData] = useState({
    image_url: '',
    headline: '',
    description: '',
    title: '',
    article: '',
    seo_title: '',
    seo_description: '',
    seo_keywords: '',
    seo_slug: '',
    cta1_label: '',
    cta1_url: '',
    cta2_label: '',
    cta2_url: '',
    placement: 'homepage' as CarouselPlacement,
    orientation: 'landscape' as CarouselOrientation,
    display_order: 0,
    is_active: true,
  })
  const [formData, setFormData] = useState<{
    name: string
    city: string
    country: string
    currency: string
    show_venue: boolean
    venueName: string
    addressLine1: string
    addressLine2: string
    townCity: string
    postcode: string
    event_date: string
    details: string
    event_summary: string
    event_what_to_bring: string
    event_refund: string
    event_timeline_label: string
    event_timeline_text: string
    event_duration: number
    min_target: number
    max_tickets: string
    price_pounds: number
    points_awarded: number
    status: Event['status']
    admin_email: string
    latitude: string
    longitude: string
    event_type: 'physical' | 'hybrid'
    hybrid_link: string
    hybrid_details: string
    hybrid_price_pounds: string
    is_hidden: boolean
    personalise_ticket: boolean
    wallet_hero_image_url: string
    wallet_strip_1x_url: string
    wallet_strip_2x_url: string
    wallet_strip_3x_url: string
    fulfilment_allowed: boolean
    is_featured: boolean
    event_program: 'yauga_haus' | 'ritual_room' | 'run_club'
    host_id: string
  }>({
    name: '',
    city: '',
    country: 'United Kingdom',
    currency: 'GBP',
    show_venue: true,
    venueName: '',
    addressLine1: '',
    addressLine2: '',
    townCity: '',
    postcode: '',
    event_date: '',
    details: '',
    event_summary: '',
    event_what_to_bring: '- Comfortable clothing\n- Yoga Mat\n- Drinks Bottle',
    event_refund: 'You can receive a refund if you cancel 28 days or more before the event.',
    event_timeline_label: 'The night',
    event_timeline_text: '',
    event_duration: 2,
    min_target: 10,
    max_tickets: '',
    price_pounds: 25.0,
    points_awarded: 10,
    status: 'collecting_interest',
    admin_email: '',
    latitude: '',
    longitude: '',
    event_type: 'physical',
    hybrid_link: '',
    hybrid_details: '',
    hybrid_price_pounds: '',
    is_hidden: false,
    personalise_ticket: false,
    wallet_hero_image_url: '',
    wallet_strip_1x_url: '',
    wallet_strip_2x_url: '',
    wallet_strip_3x_url: '',
    fulfilment_allowed: true,
    is_featured: false,
    event_program: 'yauga_haus',
    host_id: '',
  })
  const [walletHeroFile, setWalletHeroFile] = useState<File | null>(null)
  const [walletStrip1xFile, setWalletStrip1xFile] = useState<File | null>(null)
  const [walletStrip2xFile, setWalletStrip2xFile] = useState<File | null>(null)
  const [walletStrip3xFile, setWalletStrip3xFile] = useState<File | null>(null)

  type ExistingEventImageDraft = {
    kind: 'existing'
    id: string
    storage_path: string
    image_url: string
    alt_text: string
    display_order: number
    library_image_id: string | null
    orientation: 'landscape' | 'portrait'
  }

  type NewEventImageDraft = {
    kind: 'new'
    file: File
    preview_url: string
    alt_text: string
    display_order: number
    orientation: 'landscape' | 'portrait'
  }

  type LibraryPickEventImageDraft = {
    kind: 'library_pick'
    library_image_id: string
    storage_path: string
    image_url: string
    alt_text: string
    display_order: number
    orientation: 'landscape' | 'portrait'
  }

  type EventImageDraft = ExistingEventImageDraft | NewEventImageDraft | LibraryPickEventImageDraft

  const [libraryPickerOpen, setLibraryPickerOpen] = useState(false)
  const [eventImagesLoading, setEventImagesLoading] = useState(false)
  const [eventImageDrafts, setEventImageDrafts] = useState<EventImageDraft[]>([])
  const [deletedEventImageDrafts, setDeletedEventImageDrafts] = useState<
    Array<{ id: string; storage_path: string; delete_storage: boolean }>
  >([])
  const [eventImagesUploading, setEventImagesUploading] = useState(false)
  const [eventsPage, setEventsPage] = useState(1)
  const [showFilters, setShowFilters] = useState(false)
  const [eventsListView, setEventsListView] = useState<'active' | 'completed' | 'featured'>('active')
  const [eventsFilter, setEventsFilter] = useState({
    dateFrom: '',
    dateTo: '',
    location: '',
    id: '',
  })
  const [errors, setErrors] = useState<Record<string, string>>({})
  const [geocoding, setGeocoding] = useState(false)
  // Manager assignment modal state
  const [showManagerModal, setShowManagerModal] = useState(false)
  const [selectedUserForManager, setSelectedUserForManager] = useState<UserProfile | null>(null)
  const [managerFormData, setManagerFormData] = useState({
    commission_percentage: 25.0,
    territory_type: 'open' as 'country' | 'state' | 'city' | 'open',
    territory_value: '',
    contract_end_date: '',
  })
  const [monitoringPage, setMonitoringPage] = useState(1)
  const monitoringPageSize = 20

  const { data: session, isLoading: sessionLoading } = useQuery({
    queryKey: ['session'],
    queryFn: () => authApi.getSession(),
  })

  const userEmail = session?.user?.email

  type AdminNavTab = {
    key: string
    label: string
    onClick: () => void
    /** When set, this nav item is selected for any matching activeTab (e.g. Users + Loyalty + Redemptions). */
    matches?: (t: typeof activeTab) => boolean
  }

  const adminNavTabSelected = (tab: AdminNavTab) =>
    tab.matches ? tab.matches(activeTab) : activeTab === tab.key

  const handleTabListKeyDown = (e: React.KeyboardEvent<HTMLElement>) => {
    if (!['ArrowLeft', 'ArrowRight', 'Home', 'End'].includes(e.key)) return

    const tabList = e.currentTarget
    const tabs = Array.from(tabList.querySelectorAll<HTMLElement>('[role="tab"]'))
    if (tabs.length === 0) return

    const activeEl = document.activeElement as HTMLElement | null
    const currentIndex = Math.max(0, tabs.findIndex(t => t === activeEl))

    let nextIndex = currentIndex
    if (e.key === 'ArrowLeft') nextIndex = (currentIndex - 1 + tabs.length) % tabs.length
    if (e.key === 'ArrowRight') nextIndex = (currentIndex + 1) % tabs.length
    if (e.key === 'Home') nextIndex = 0
    if (e.key === 'End') nextIndex = tabs.length - 1

    e.preventDefault()
    tabs[nextIndex].focus()
    tabs[nextIndex].click()
  }

  const { data: securityEventsData, isLoading: isLoadingSecurityEvents, error: securityEventsError } = useQuery({
    queryKey: ['security-events', monitoringPage, monitoringPageSize],
    queryFn: () => securityEventsApi.list({ page: monitoringPage, pageSize: monitoringPageSize }),
    enabled: activeTab === 'monitoring',
  })

  const clearSecurityEventsMutation = useMutation({
    mutationFn: async () => {
      await securityEventsApi.clearAll()
    },
    onSuccess: () => {
      setMonitoringPage(1)
      queryClient.invalidateQueries({ queryKey: ['security-events'] })
      toast.success('Security events cleared')
    },
    onError: (e: any) => {
      toast.error(e?.message || 'Failed to clear events')
    },
  })

  const confirmDialog = useA11yDialog({
    isOpen: !!(confirmModal && confirmModal.show),
    onClose: () => setConfirmModal(null),
    initialFocusSelector: 'button',
  })

  const testBookingDeleteDialog = useA11yDialog({
    isOpen: !!testBookingDelete,
    onClose: () => setTestBookingDelete(null),
    initialFocusSelector: testBookingDelete?.step === 'email' ? 'input' : 'button',
  })

  const regenerateEventDialog = useA11yDialog({
    isOpen: !!regenerateEventModal,
    onClose: () => {
      if (!regenerateEventModal?.isSending) setRegenerateEventModal(null)
    },
    initialFocusSelector: 'button',
  })

  const checklistDialog = useA11yDialog({
    isOpen: !!(showChecklistModal && eventToOpen),
    onClose: () => {
      setShowChecklistModal(false)
      setEventToOpen(null)
      setChecklistCheckedItems(new Set())
    },
    initialFocusSelector: 'button',
  })

  const managerDialog = useA11yDialog({
    isOpen: !!(showManagerModal && selectedUserForManager),
    onClose: () => {
      setShowManagerModal(false)
      setSelectedUserForManager(null)
    },
    initialFocusSelector: '#commission',
  })

  const bulkUploadDialog = useA11yDialog({
    isOpen: showBulkUploadModal,
    onClose: () => {
      setShowBulkUploadModal(false)
      setBulkUploadFile(null)
      setBulkUploadIsProcessing(false)
      setBulkUploadResults([])
      setBulkUploadProgress(null)
    },
    initialFocusSelector: '#bulk-upload-download-template',
  })

  // Auto-geocode when city or country changes
  useEffect(() => {
    if (formData.city && formData.city.length > 2 && formData.country) {
      const timeoutId = setTimeout(async () => {
        setGeocoding(true)
        const coords = await geocodeCity(formData.city, formData.country, legalEmail)
        if (coords) {
          setFormData((prev) => ({
            ...prev,
            latitude: coords.lat.toString(),
            longitude: coords.lng.toString(),
          }))
        }
        setGeocoding(false)
      }, 1000) // Debounce 1 second

      return () => clearTimeout(timeoutId)
    }
  }, [formData.city, formData.country, legalEmail])

  const { data: myEvents = [] } = useQuery({
    queryKey: ['admin-events'],
    queryFn: () => adminApi.listAllEvents(),
    enabled: !!userEmail,
  })

  const {
    data: editorRouteEvent,
    isLoading: editorRouteEventLoading,
    error: editorRouteEventError,
  } = useQuery({
    queryKey: ['admin-event-for-editor', editEventId],
    queryFn: () => adminApi.getEventById(editEventId!),
    enabled: eventEditor === 'edit' && !!editEventId && !!userEmail,
  })

  const { data: featuredEligibleEvents = [], isLoading: isLoadingFeaturedEligible } = useQuery({
    queryKey: ['admin-events-featured-eligible'],
    queryFn: () => adminApi.listFutureEventsWithImages(),
    enabled: !!userEmail && activeTab === 'events' && eventsListView === 'featured',
  })

  // Filter and paginate events
  const filteredEvents = useMemo(() => {
    let filtered = [...myEvents]

    // Active vs completed view
    if (eventsListView === 'completed') {
      filtered = filtered.filter(e => e.status === 'completed')
    } else {
      filtered = filtered.filter(e => e.status !== 'completed')
    }

    if (eventsFilter.dateFrom) {
      filtered = filtered.filter(event => event.event_date && new Date(event.event_date) >= new Date(eventsFilter.dateFrom))
    }
    if (eventsFilter.dateTo) {
      filtered = filtered.filter(event => event.event_date && new Date(event.event_date) <= new Date(eventsFilter.dateTo))
    }
    if (eventsFilter.location) {
      const searchLower = eventsFilter.location.toLowerCase()
      filtered = filtered.filter(event =>
        event.city.toLowerCase().includes(searchLower) ||
        event.location?.toLowerCase().includes(searchLower) ||
        event.name.toLowerCase().includes(searchLower)
      )
    }
    if (eventsFilter.id) {
      const idSearch = eventsFilter.id.trim().toLowerCase()
      filtered = filtered.filter(event => (event.id || '').toLowerCase().includes(idSearch))
    }

    // Sort by date (active: earliest first, completed: most recent first)
    filtered.sort((a, b) => {
      const dateA = a.event_date ? new Date(a.event_date).getTime() : 0
      const dateB = b.event_date ? new Date(b.event_date).getTime() : 0
      return eventsListView === 'completed' ? (dateB - dateA) : (dateA - dateB)
    })

    return filtered
  }, [myEvents, eventsFilter, eventsListView])

  const eventsPerPage = 10
  const totalPages = Math.ceil(filteredEvents.length / eventsPerPage)
  const paginatedEvents = useMemo(() => {
    const startIndex = (eventsPage - 1) * eventsPerPage
    return filteredEvents.slice(startIndex, startIndex + eventsPerPage)
  }, [filteredEvents, eventsPage, eventsPerPage])

  const featuredEligibleTotalPages = Math.ceil(featuredEligibleEvents.length / eventsPerPage)
  const featuredPaginatedEvents = useMemo(() => {
    const startIndex = (eventsPage - 1) * eventsPerPage
    return featuredEligibleEvents.slice(startIndex, startIndex + eventsPerPage)
  }, [featuredEligibleEvents, eventsPage, eventsPerPage])

  const { data: eventTickets = [] } = useQuery({
    queryKey: ['event-tickets', selectedEvent?.id],
    queryFn: () => (selectedEvent ? adminApi.getEventTickets(selectedEvent.id) : []),
    enabled: !!selectedEvent,
  })

  const { data: eventPickupReport = [] } = useQuery({
    queryKey: ['event-pickup-report', selectedEvent?.id],
    queryFn: () => (selectedEvent ? adminApi.getEventPickupReport(selectedEvent.id) : []),
    enabled: !!selectedEvent && viewMode === 'class-list',
  })

  const { data: eventAttendees = [] } = useQuery({
    queryKey: ['event-attendees', selectedEvent?.id],
    queryFn: () => (selectedEvent ? adminApi.getEventAttendees(selectedEvent.id) : []),
    enabled: !!selectedEvent && viewMode === 'attendees',
  })

  const { data: eventRevenue } = useQuery({
    queryKey: ['event-revenue', selectedEvent?.id],
    queryFn: () => (selectedEvent ? adminApi.getEventRevenue(selectedEvent.id) : null),
    enabled: !!selectedEvent && viewMode === 'revenue',
  })

  const { data: popularLocations = [] } = useQuery({
    queryKey: ['popular-locations', userEmail],
    queryFn: () => (userEmail ? adminApi.getPopularLocations(userEmail) : []),
    enabled: !!userEmail,
  })

  const { data: bookingStats } = useQuery({
    queryKey: ['booking-statistics', userEmail],
    queryFn: () => (userEmail ? adminApi.getBookingStatistics(userEmail) : null),
    enabled: !!userEmail && activeTab === 'reporting',
  })

  const { data: bookingsByMonth = [] } = useQuery({
    queryKey: ['bookings-by-month', userEmail],
    queryFn: () => (userEmail ? adminApi.getBookingsByMonth(userEmail, { monthsBack: 12 }) : []),
    enabled: !!userEmail && activeTab === 'reporting',
  })

  const { data: bookingFeesByMonth = [] } = useQuery({
    queryKey: ['booking-fees-by-month'],
    queryFn: () => adminApi.getBookingFeesByMonth({ monthsBack: 12 }),
    enabled: activeTab === 'reporting',
  })

  const { data: salesExVatByMonth = [] } = useQuery({
    queryKey: ['platform-sales-ex-vat-by-month'],
    queryFn: async () => {
      const [t, s] = await Promise.all([
        adminApi.getPlatformTicketSalesNetPenceByMonth({ monthsBack: 12 }),
        adminApi.getPlatformShopSalesNetPenceByMonth({ monthsBack: 12 }),
      ])
      const shopMap = new Map(s.map((x) => [x.monthKey, x.netPence]))
      return t.map((row) => ({
        monthKey: row.monthKey,
        label: row.label,
        ticketNetPence: row.netPence,
        shopNetPence: shopMap.get(row.monthKey) || 0,
      }))
    },
    enabled: activeTab === 'reporting',
  })

  const [showDnaDrilldown, setShowDnaDrilldown] = useState(false)
  const { data: topDnaEvents = [], isLoading: isLoadingTopDnaEvents } = useQuery({
    queryKey: ['top-dna-events', userEmail],
    queryFn: () => (userEmail ? adminApi.getTopDnaEvents(userEmail, { limit: 10 }) : []),
    enabled: !!userEmail && activeTab === 'reporting' && showDnaDrilldown,
  })

  // Revenue report state
  const [revenueViewMode, setRevenueViewMode] = useState<'platform' | 'manager'>('platform')
  const [reportingSubTab, setReportingSubTab] = useState<'dashboard' | 'location-votes' | 'city-lead-sources'>('dashboard')
  const [revenueFilterType, setRevenueFilterType] = useState<'month' | 'year' | 'period'>('year')
  const [revenueMonth, setRevenueMonth] = useState<string>('')
  const [revenueYear, setRevenueYear] = useState<number>(new Date().getFullYear())
  const [revenueStartDate, setRevenueStartDate] = useState<string>('')
  const [revenueEndDate, setRevenueEndDate] = useState<string>('')
  const [selectedManagerForRevenue, setSelectedManagerForRevenue] = useState<string>('')
  const [selectedEventForDetails, setSelectedEventForDetails] = useState<string | null>(null)
  const [showEventDetailsModal, setShowEventDetailsModal] = useState(false)
  const [selectedMonthForDetails, setSelectedMonthForDetails] = useState<string | null>(null)
  const [showMonthDetailsModal, setShowMonthDetailsModal] = useState(false)
  const [platformRevenueSalesTab, setPlatformRevenueSalesTab] = useState<'events' | 'products'>('events')

  // Platform revenue query
  const { data: platformRevenue } = useQuery({
    queryKey: ['platform-revenue', revenueFilterType, revenueMonth, revenueYear, revenueStartDate, revenueEndDate],
    queryFn: () => {
      const filters: any = {}
      if (revenueFilterType === 'month' && revenueMonth && revenueYear) {
        filters.month = revenueMonth
        filters.year = revenueYear
      } else if (revenueFilterType === 'year' && revenueYear) {
        filters.year = revenueYear
      } else if (revenueFilterType === 'period' && revenueStartDate && revenueEndDate) {
        filters.startDate = revenueStartDate
        filters.endDate = revenueEndDate
      }
      return adminApi.getPlatformRevenue(filters)
    },
    enabled: activeTab === 'reporting' && revenueViewMode === 'platform',
  })

  // Manager revenue query
  const { data: managerRevenue } = useQuery({
    queryKey: ['manager-revenue', selectedManagerForRevenue, revenueFilterType, revenueMonth, revenueYear, revenueStartDate, revenueEndDate],
    queryFn: () => {
      if (!selectedManagerForRevenue) return null
      const filters: any = {}
      if (revenueFilterType === 'month' && revenueMonth && revenueYear) {
        filters.month = revenueMonth
        filters.year = revenueYear
      } else if (revenueFilterType === 'year' && revenueYear) {
        filters.year = revenueYear
      } else if (revenueFilterType === 'period' && revenueStartDate && revenueEndDate) {
        filters.startDate = revenueStartDate
        filters.endDate = revenueEndDate
      }
      return adminApi.getManagerRevenue(selectedManagerForRevenue, filters)
    },
    enabled: activeTab === 'reporting' && revenueViewMode === 'manager' && !!selectedManagerForRevenue,
  })

  const { data: managerLeaderboard = [], isLoading: isLoadingManagerLeaderboard } = useQuery({
    queryKey: ['manager-revenue-leaderboard', revenueViewMode, revenueFilterType, revenueMonth, revenueYear, revenueStartDate, revenueEndDate, selectedManagerForRevenue],
    queryFn: () => {
      if (revenueViewMode !== 'manager') return []
      const filters: any = { managerEmail: selectedManagerForRevenue || undefined }
      if (revenueFilterType === 'month' && revenueMonth && revenueYear) {
        filters.month = revenueMonth
        filters.year = revenueYear
      } else if (revenueFilterType === 'year' && revenueYear) {
        filters.year = revenueYear
      } else if (revenueFilterType === 'period' && revenueStartDate && revenueEndDate) {
        filters.startDate = revenueStartDate
        filters.endDate = revenueEndDate
      }
      return adminApi.getManagerRevenueLeaderboard(filters)
    },
    enabled: activeTab === 'reporting' && revenueViewMode === 'manager',
  })

  // Export platform revenue to CSV
  const handleExportPlatformRevenueCSV = () => {
    if (!platformRevenue) return

    // Format period string
    let periodStr = 'All Time'
    if (revenueFilterType === 'period' && revenueStartDate && revenueEndDate) {
      periodStr = `${new Date(revenueStartDate).toLocaleDateString('en-GB')} - ${new Date(revenueEndDate).toLocaleDateString('en-GB')}`
    } else if (revenueFilterType === 'month' && revenueMonth && revenueYear) {
      const monthName = new Date(revenueYear, parseInt(revenueMonth)).toLocaleString('default', { month: 'long' })
      periodStr = `${monthName} ${revenueYear}`
    } else if (revenueFilterType === 'year' && revenueYear) {
      periodStr = `Year ${revenueYear}`
    }

    // Create CSV content
    let csvContent = 'Platform Revenue Report\n'
    csvContent += `Period: ${periodStr}\n`
    csvContent += `Generated: ${new Date().toLocaleString('en-GB')}\n\n`
    
    // Summary
    csvContent += 'Summary\n'
    csvContent += `Gross Revenue,£${platformRevenue.totalRevenue.toLocaleString('en-GB', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}\n`
    csvContent += `Taxes (VAT),£${(platformRevenue.totalVAT || 0).toLocaleString('en-GB', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}\n`
    csvContent += `Net Revenue,£${(platformRevenue.totalNetRevenue || platformRevenue.totalRevenue).toLocaleString('en-GB', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}\n`
    csvContent += `Total Tickets,${platformRevenue.totalTickets}\n`
    csvContent += `Total Shop Orders,${platformRevenue.totalShopOrders ?? 0}\n`
    csvContent += `Ticket revenue (gross),£${(platformRevenue.ticketRevenueGross ?? 0).toLocaleString('en-GB', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}\n`
    csvContent += `Shop revenue (gross),£${(platformRevenue.shopRevenueGross ?? 0).toLocaleString('en-GB', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}\n\n`

    // Revenue by Month
    if (platformRevenue.revenueByMonth.length > 0) {
      csvContent += 'Revenue by Month\n'
      csvContent += 'Month,Gross Revenue,Taxes (VAT),Net Revenue,Tickets,Shop orders,Ticket revenue,Shop revenue\n'
      platformRevenue.revenueByMonth.forEach(month => {
        const m = month as typeof month & { shopOrders?: number; ticketRevenue?: number; shopRevenue?: number }
        csvContent += `"${month.month}",£${month.revenue.toLocaleString('en-GB', { minimumFractionDigits: 2, maximumFractionDigits: 2 })},£${(month.vat || 0).toLocaleString('en-GB', { minimumFractionDigits: 2, maximumFractionDigits: 2 })},£${(month.netRevenue || month.revenue).toLocaleString('en-GB', { minimumFractionDigits: 2, maximumFractionDigits: 2 })},${month.tickets},${m.shopOrders ?? 0},£${(m.ticketRevenue ?? 0).toLocaleString('en-GB', { minimumFractionDigits: 2, maximumFractionDigits: 2 })},£${(m.shopRevenue ?? 0).toLocaleString('en-GB', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}\n`
      })
      csvContent += '\n'
    }

    // Revenue by Event
    if (platformRevenue.revenueByEvent.length > 0) {
      csvContent += 'Revenue by Event\n'
      csvContent += 'Event,Location,Tickets,Gross Revenue,Taxes (VAT),Net Revenue\n'
      platformRevenue.revenueByEvent.forEach(event => {
        csvContent += `"${event.eventName}","${event.city}, ${event.country}",${event.tickets},£${event.revenue.toLocaleString('en-GB', { minimumFractionDigits: 2, maximumFractionDigits: 2 })},£${(event.vat || 0).toLocaleString('en-GB', { minimumFractionDigits: 2, maximumFractionDigits: 2 })},£${(event.netRevenue || event.revenue).toLocaleString('en-GB', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}\n`
      })
      csvContent += '\n'
    }

    const products = platformRevenue.revenueByProduct ?? []
    if (products.length > 0) {
      csvContent += 'Revenue by Product\n'
      csvContent += 'Product,SKU,Units sold,Gross revenue\n'
      products.forEach((p) => {
        csvContent += `"${p.name}","${p.sku}",${p.unitsSold},£${p.grossRevenue.toLocaleString('en-GB', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}\n`
      })
    }

    // Download CSV
    const blob = new Blob([csvContent], { type: 'text/csv;charset=utf-8;' })
    const url = URL.createObjectURL(blob)
    const link = document.createElement('a')
    link.href = url
    link.download = `platform-revenue-report-${periodStr.replace(/\s+/g, '-')}-${Date.now()}.csv`
    document.body.appendChild(link)
    link.click()
    document.body.removeChild(link)
    URL.revokeObjectURL(url)
    toast.success('CSV exported successfully!')
  }

  // Export manager revenue to CSV
  const handleExportManagerRevenueCSV = () => {
    if (!managerRevenue) return

    // Format period string
    let periodStr = 'All Time'
    if (revenueFilterType === 'period' && revenueStartDate && revenueEndDate) {
      periodStr = `${new Date(revenueStartDate).toLocaleDateString('en-GB')} - ${new Date(revenueEndDate).toLocaleDateString('en-GB')}`
    } else if (revenueFilterType === 'month' && revenueMonth && revenueYear) {
      const monthName = new Date(revenueYear, parseInt(revenueMonth)).toLocaleString('default', { month: 'long' })
      periodStr = `${monthName} ${revenueYear}`
    } else if (revenueFilterType === 'year' && revenueYear) {
      periodStr = `Year ${revenueYear}`
    }

    // Create CSV content
    let csvContent = 'Manager Revenue Report\n'
    csvContent += `Manager: ${managerRevenue.managerName}\n`
    csvContent += `Email: ${managerRevenue.managerEmail}\n`
    csvContent += `Platform Share: ${managerRevenue.commissionPercentage}%\n`
    csvContent += `Period: ${periodStr}\n`
    csvContent += `Generated: ${new Date().toLocaleString('en-GB')}\n\n`
    
    // Summary
    csvContent += 'Summary\n'
    csvContent += `Gross Revenue,£${managerRevenue.totalRevenue.toLocaleString('en-GB', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}\n`
    csvContent += `Taxes (VAT),£${(managerRevenue.totalVAT || 0).toLocaleString('en-GB', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}\n`
    csvContent += `Net Revenue,£${(managerRevenue.totalNetRevenue || managerRevenue.totalRevenue).toLocaleString('en-GB', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}\n`
    csvContent += `Platform Share,£${managerRevenue.totalCommission.toLocaleString('en-GB', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}\n`
    csvContent += `Due to Manager,£${managerRevenue.totalDue.toLocaleString('en-GB', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}\n`
    csvContent += `Total Tickets,${managerRevenue.totalTickets}\n\n`

    // Revenue by Event
    if (managerRevenue.events.length > 0) {
      csvContent += 'Revenue by Event\n'
      csvContent += 'Event,Date,Tickets,Gross Revenue,Taxes (VAT),Net Revenue,Platform Share,Due to Manager\n'
      managerRevenue.events.forEach(event => {
        const eventDate = event.event_date ? new Date(event.event_date).toLocaleDateString('en-GB') : 'N/A'
        csvContent += `"${event.event_name}","${eventDate}",${event.ticket_count},£${event.total_revenue.toLocaleString('en-GB', { minimumFractionDigits: 2, maximumFractionDigits: 2 })},£${(event.vat_amount || 0).toLocaleString('en-GB', { minimumFractionDigits: 2, maximumFractionDigits: 2 })},£${(event.net_revenue || event.total_revenue).toLocaleString('en-GB', { minimumFractionDigits: 2, maximumFractionDigits: 2 })},£${event.commission.toLocaleString('en-GB', { minimumFractionDigits: 2, maximumFractionDigits: 2 })},£${event.revenue_due.toLocaleString('en-GB', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}\n`
      })
    }

    // Download CSV
    const blob = new Blob([csvContent], { type: 'text/csv;charset=utf-8;' })
    const url = URL.createObjectURL(blob)
    const link = document.createElement('a')
    link.href = url
    link.download = `manager-revenue-report-${managerRevenue.managerName.replace(/\s+/g, '-')}-${periodStr.replace(/\s+/g, '-')}-${Date.now()}.csv`
    document.body.appendChild(link)
    link.click()
    document.body.removeChild(link)
    URL.revokeObjectURL(url)
    toast.success('CSV exported successfully!')
  }

  // Download manager revenue report as PDF
  const handleDownloadManagerPDF = () => {
    if (!managerRevenue) return

    // Format period string
    let periodStr = 'All Time'
    if (revenueFilterType === 'period' && revenueStartDate && revenueEndDate) {
      periodStr = `${new Date(revenueStartDate).toLocaleDateString('en-GB')} - ${new Date(revenueEndDate).toLocaleDateString('en-GB')}`
    } else if (revenueFilterType === 'month' && revenueMonth && revenueYear) {
      const monthName = new Date(revenueYear, parseInt(revenueMonth)).toLocaleString('default', { month: 'long' })
      periodStr = `${monthName} ${revenueYear}`
    } else if (revenueFilterType === 'year' && revenueYear) {
      periodStr = `Year ${revenueYear}`
    }

    // Generate HTML for PDF
    const htmlContent = `
<!DOCTYPE html>
<html>
<head>
  <meta charset="UTF-8">
  <style>
    body {
      font-family: Arial, sans-serif;
      margin: 40px;
      color: #1f2937;
    }
    .header {
      text-align: center;
      margin-bottom: 30px;
      border-bottom: 2px solid #8277FF;
      padding-bottom: 20px;
    }
    .header h1 {
      color: #8277FF;
      margin: 0;
      font-size: 28px;
    }
    .info-section {
      margin-bottom: 30px;
    }
    .info-row {
      display: flex;
      justify-content: space-between;
      margin-bottom: 10px;
      padding: 8px 0;
      border-bottom: 1px solid #e5e7eb;
    }
    .info-label {
      font-weight: 600;
      color: #6b7280;
    }
    .summary-cards {
      display: grid;
      grid-template-columns: repeat(4, 1fr);
      gap: 15px;
      margin-bottom: 30px;
    }
    .summary-card {
      background: #f9fafb;
      padding: 15px;
      border-radius: 8px;
      border: 1px solid #e5e7eb;
      text-align: center;
    }
    .summary-card-label {
      font-size: 12px;
      color: #6b7280;
      margin-bottom: 8px;
    }
    .summary-card-value {
      font-size: 20px;
      font-weight: 700;
      color: #8277FF;
    }
    table {
      width: 100%;
      border-collapse: collapse;
      margin-top: 20px;
    }
    th {
      background-color: #f3f4f6;
      padding: 12px;
      text-align: left;
      font-weight: 600;
      font-size: 12px;
      text-transform: uppercase;
      color: #374151;
      border-bottom: 2px solid #e5e7eb;
    }
    td {
      padding: 12px;
      border-bottom: 1px solid #e5e7eb;
      font-size: 14px;
    }
    .text-right {
      text-align: right;
    }
    .text-green {
      color: #10b981;
      font-weight: 600;
    }
    .footer {
      margin-top: 40px;
      padding-top: 20px;
      border-top: 1px solid #e5e7eb;
      text-align: center;
      color: #6b7280;
      font-size: 12px;
    }
  </style>
</head>
<body>
  <div class="header">
    <h1>${brandName}</h1>
    <p style="margin: 10px 0 0 0; color: #6b7280;">Manager Revenue Report</p>
  </div>

  <div class="info-section">
    <div class="info-row">
      <span class="info-label">Manager:</span>
      <span>${managerRevenue.managerName}</span>
    </div>
    <div class="info-row">
      <span class="info-label">Email:</span>
      <span>${managerRevenue.managerEmail}</span>
    </div>
    <div class="info-row">
      <span class="info-label">Platform Share:</span>
      <span>${managerRevenue.commissionPercentage}%</span>
    </div>
    <div class="info-row">
      <span class="info-label">Report Period:</span>
      <span>${periodStr}</span>
    </div>
    <div class="info-row">
      <span class="info-label">Generated:</span>
      <span>${new Date().toLocaleString('en-GB')}</span>
    </div>
  </div>

  <div class="summary-cards">
    <div class="summary-card">
      <div class="summary-card-label">Total Revenue</div>
      <div class="summary-card-value">£${managerRevenue.totalRevenue.toLocaleString('en-GB', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</div>
    </div>
    <div class="summary-card">
      <div class="summary-card-label">Platform Share</div>
      <div class="summary-card-value">£${managerRevenue.totalCommission.toLocaleString('en-GB', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</div>
    </div>
    <div class="summary-card">
      <div class="summary-card-label">Due to Manager</div>
      <div class="summary-card-value" style="color: #10b981;">£${managerRevenue.totalDue.toLocaleString('en-GB', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</div>
    </div>
    <div class="summary-card">
      <div class="summary-card-label">Total Tickets</div>
      <div class="summary-card-value">${managerRevenue.totalTickets}</div>
    </div>
  </div>

  <table>
    <thead>
      <tr>
        <th>Event</th>
        <th>Date</th>
        <th class="text-right">Tickets</th>
        <th class="text-right">Total Revenue</th>
        <th class="text-right">Platform Share</th>
        <th class="text-right">Due to Manager</th>
      </tr>
    </thead>
    <tbody>
      ${managerRevenue.events.map((event: any) => `
        <tr>
          <td>${event.event_name}</td>
          <td>${event.event_date ? new Date(event.event_date).toLocaleDateString('en-GB') : 'N/A'}</td>
          <td class="text-right">${event.ticket_count}</td>
          <td class="text-right">£${event.total_revenue.toLocaleString('en-GB', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</td>
          <td class="text-right">£${event.commission.toLocaleString('en-GB', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</td>
          <td class="text-right text-green">£${event.revenue_due.toLocaleString('en-GB', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</td>
        </tr>
      `).join('')}
    </tbody>
    <tfoot>
      <tr style="background-color: #f9fafb; font-weight: 600;">
        <td colspan="3">Total</td>
        <td class="text-right">£${managerRevenue.totalRevenue.toLocaleString('en-GB', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</td>
        <td class="text-right">£${managerRevenue.totalCommission.toLocaleString('en-GB', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</td>
        <td class="text-right text-green">£${managerRevenue.totalDue.toLocaleString('en-GB', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</td>
      </tr>
    </tfoot>
  </table>

  <div class="footer">
    <p>This report was generated automatically by ${brandName}.</p>
    <p>For questions, please contact your administrator.</p>
  </div>
</body>
</html>
    `

    // Create a blob and download
    const blob = new Blob([htmlContent], { type: 'text/html' })
    const url = URL.createObjectURL(blob)
    const link = document.createElement('a')
    link.href = url
    link.download = `revenue-report-${managerRevenue.managerName.replace(/\s+/g, '-')}-${periodStr.replace(/\s+/g, '-')}-${Date.now()}.html`
    document.body.appendChild(link)
    link.click()
    document.body.removeChild(link)
    URL.revokeObjectURL(url)

    // Also try to print as PDF (browser's print to PDF)
    toast.success('Report downloaded. You can print it as PDF using your browser\'s print function (Ctrl+P / Cmd+P)')
  }

  const { data: carouselItems = [] } = useQuery({
    queryKey: ['carousel-items-all'],
    queryFn: () => carouselApi.listAll(),
  })

  const [contentManagementTab, setContentManagementTab] = useState<
    'legal-pages' | 'carousel' | 'faq' | 'checklist' | 'location-library' | 'hosts' | 'rings' | 'partners' | 'whatsapp' | 'nda' | 'contracts' | 'meditation'
  >('legal-pages')

  useEffect(() => {
    if (routeLocation.pathname.replace(/\/$/, '') === '/admin/carousel') {
      setActiveTab('legal')
      setContentManagementTab('carousel')
      return
    }
    if (routeLocation.pathname.replace(/\/$/, '') !== '/admin') return
    const cm = new URLSearchParams(routeLocation.search).get('cm')
    if (
      cm === 'hosts' ||
      cm === 'rings' ||
      cm === 'carousel' ||
      cm === 'location-library' ||
      cm === 'partners' ||
      cm === 'faq' ||
      cm === 'checklist' ||
      cm === 'legal-pages' ||
      cm === 'whatsapp' ||
      cm === 'nda' ||
      cm === 'contracts' ||
      cm === 'meditation'
    ) {
      setActiveTab('legal')
      setContentManagementTab(cm)
    }
  }, [routeLocation.pathname, routeLocation.search])

  const { data: locationLibraryList = [] } = useQuery({
    queryKey: ['location-library-images'],
    queryFn: () => locationLibraryApi.list(),
    enabled:
      !!userEmail &&
      (eventEditor === 'create' ||
        eventEditor === 'edit' ||
        (activeTab === 'legal' && contentManagementTab === 'location-library')),
  })

  const { data: eventHosts = [] } = useQuery({
    queryKey: ['event-hosts'],
    queryFn: () => eventHostsApi.list(),
    enabled:
      !!userEmail &&
      (eventEditor === 'create' ||
        eventEditor === 'edit' ||
        (activeTab === 'legal' && contentManagementTab === 'hosts')),
  })

  const { data: faqs = [] } = useQuery({
    queryKey: ['faqs-all'],
    queryFn: () => faqApi.listAll(),
    enabled: activeTab === 'legal' && contentManagementTab === 'faq',
  })

  const { data: userProfiles = [] } = useQuery({
    queryKey: ['user-profiles'],
    queryFn: () => userProfilesApi.listAll(),
    enabled: activeTab === 'users',
  })
  const [userFilter, setUserFilter] = useState('')
  const [userRoleFilter, setUserRoleFilter] = useState<'all' | 'admin' | 'manager' | 'practitioner'>('all')

  const { data: adminUserAudit = [] } = useQuery({
    queryKey: ['admin-user-audit'],
    queryFn: async () => {
      const { data, error } = await supabase.functions.invoke('admin-user-audit', { body: {} })
      if (error) throw error
      return ((data as any)?.users || []) as Array<{
        email: string
        last_sign_in_at: string | null
        created_at: string | null
        bookings_count?: number
        paid_bookings_count: number
        inactive_90d: boolean
      }>
    },
    enabled: activeTab === 'users',
    retry: false,
  })

  const { data: managers = [] } = useQuery({
    queryKey: ['managers'],
    queryFn: () => managersApi.list(),
    enabled: activeTab === 'users' || activeTab === 'events', // Also fetch for events tab to show manager info
  })
  const managerEmails = useMemo(
    () => new Set(managers.map((m) => (m.email || '').toLowerCase()).filter(Boolean)),
    [managers]
  )
  const filteredUserProfiles = useMemo(() => {
    const q = userFilter.trim().toLowerCase()
    return userProfiles.filter((profile) => {
      if (q) {
        const email = (profile.email || '').toLowerCase()
        const name = (profile.name || '').toLowerCase()
        if (!email.includes(q) && !name.includes(q)) return false
      }
      if (userRoleFilter === 'admin') return profile.is_admin === true
      if (userRoleFilter === 'practitioner') return profile.is_practitioner === true
      if (userRoleFilter === 'manager') return managerEmails.has((profile.email || '').toLowerCase())
      return true
    })
  }, [userProfiles, userFilter, userRoleFilter, managerEmails])

  const deleteUserMutation = useMutation({
    mutationFn: async (email: string) => {
      const { data, error } = await supabase.functions.invoke('admin-delete-user', { body: { email } })
      if (error) throw error
      return data
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['user-profiles'] })
      queryClient.invalidateQueries({ queryKey: ['admin-user-audit'] })
      toast.success('User deleted')
    },
    onError: (error: any) => {
      toast.error(error?.message || 'Failed to delete user')
    },
  })

  const adminAuditByEmail = useMemo(() => {
    const map = new Map<string, (typeof adminUserAudit)[number]>()
    for (const a of adminUserAudit) {
      if (a?.email) map.set(a.email.toLowerCase(), a)
    }
    return map
  }, [adminUserAudit])

  const isDeletingUser = deleteUserMutation.isPending
  
  // Reassign manager modal state
  const [showReassignModal, setShowReassignModal] = useState(false)
  const [eventToReassign, setEventToReassign] = useState<Event | null>(null)
  const [reassignAllEvents, setReassignAllEvents] = useState(false)

  const { data: eventPromotions = [] } = useQuery({
    queryKey: ['event-promotions'],
    queryFn: () => promoteApi.list(),
    enabled: !!userEmail && activeTab === 'events',
    retry: false,
  })

  const { data: checklistItems = [] } = useQuery({
    queryKey: ['checklist-items'],
    queryFn: () => checklistApi.listItems(),
    enabled: activeTab === 'events' || (activeTab === 'legal' && contentManagementTab === 'checklist'),
  })

  const completeChecklistMutation = useMutation({
    mutationFn: async ({ eventId, checkedItems }: { eventId: string; checkedItems: string[] }) => {
      if (!userEmail || !session?.user?.id) throw new Error('Not authenticated')
      
      // Get user profile for name
      const userProfile = await userProfilesApi.getProfile(userEmail)
      
      // Create completion records
      const completions = checkedItems.map(itemId => ({
        checklist_item_id: itemId,
        completed_by_user_id: session.user.id,
        completed_by_email: userEmail,
        completed_by_name: userProfile?.name || null,
        notes: null,
      }))
      
      await checklistApi.completeChecklist(eventId, completions)
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['checklist-completions'] })
    },
  })

  const { data: _privacyPage } = useQuery({
    queryKey: ['legal-page', 'privacy'],
    queryFn: () => legalPagesApi.getByType('privacy'),
    enabled: activeTab === 'legal' && contentManagementTab === 'legal-pages' && legalPageType === 'privacy',
  })

  const { data: _termsPage } = useQuery({
    queryKey: ['legal-page', 'terms'],
    queryFn: () => legalPagesApi.getByType('terms'),
    enabled: activeTab === 'legal' && contentManagementTab === 'legal-pages' && legalPageType === 'terms',
  })

  const { data: _cookiesPage } = useQuery({
    queryKey: ['legal-page', 'cookies'],
    queryFn: () => legalPagesApi.getByType('cookies'),
    enabled: activeTab === 'legal' && contentManagementTab === 'legal-pages' && legalPageType === 'cookies',
  })

  const { data: _eventRequirementsPage } = useQuery({
    queryKey: ['legal-page', 'event_requirements'],
    queryFn: () => legalPagesApi.getByType('event_requirements'),
    enabled: activeTab === 'legal' && contentManagementTab === 'legal-pages' && legalPageType === 'event_requirements',
  })

  const { data: adminEmailSetting } = useQuery({
    queryKey: ['setting', 'admin_email'],
    queryFn: () => settingsApi.get('admin_email'),
    enabled: activeTab === 'settings',
  })

  const { data: emailFromSetting } = useQuery({
    queryKey: ['setting', 'email_from'],
    queryFn: () => settingsApi.get('email_from').catch(() => null),
    enabled: activeTab === 'settings',
    retry: false,
  })

  const { data: legalEmailSetting } = useQuery({
    queryKey: ['setting', 'legal_email'],
    queryFn: () => settingsApi.get('legal_email').catch(() => null),
    enabled: activeTab === 'settings',
    retry: false,
  })

  const { data: brandNameSetting } = useQuery({
    queryKey: ['setting', 'brand_name'],
    queryFn: () => settingsApi.get('brand_name').catch(() => null),
    enabled: activeTab === 'settings',
    retry: false,
  })

  const { data: socialXUrlSetting } = useQuery({
    queryKey: ['setting', 'social_x_url'],
    queryFn: () => settingsApi.get('social_x_url').catch(() => null),
    enabled: activeTab === 'settings',
    retry: false,
  })
  const { data: socialInstagramUrlSetting } = useQuery({
    queryKey: ['setting', 'social_instagram_url'],
    queryFn: () => settingsApi.get('social_instagram_url').catch(() => null),
    enabled: activeTab === 'settings',
    retry: false,
  })
  const { data: socialTiktokUrlSetting } = useQuery({
    queryKey: ['setting', 'social_tiktok_url'],
    queryFn: () => settingsApi.get('social_tiktok_url').catch(() => null),
    enabled: activeTab === 'settings',
    retry: false,
  })

  const { data: carouselDelaySetting } = useQuery({
    queryKey: ['setting', 'carousel_delay'],
    queryFn: () => settingsApi.get('carousel_delay').catch(() => null),
    enabled: activeTab === 'settings',
    retry: false,
  })

  const { data: homepageEventsLimitSetting } = useQuery({
    queryKey: ['setting', 'homepage_events_limit'],
    queryFn: () => settingsApi.get('homepage_events_limit').catch(() => null),
    enabled: activeTab === 'settings',
    retry: false,
  })

  const { data: featuredEventsPerSlideSetting } = useQuery({
    queryKey: ['setting', 'featured_events_per_slide'],
    queryFn: () => settingsApi.get('featured_events_per_slide').catch(() => null),
    enabled: activeTab === 'settings',
    retry: false,
  })

  const { data: bookingFeeEnabledSetting } = useQuery({
    queryKey: ['setting', 'booking_fee_enabled'],
    queryFn: () => settingsApi.get('booking_fee_enabled').catch(() => null),
    enabled: activeTab === 'settings',
    retry: false,
  })

  const { data: bookingFeeSetting } = useQuery({
    queryKey: ['setting', 'booking_fee'],
    queryFn: () => settingsApi.get('booking_fee').catch(() => null),
    enabled: activeTab === 'settings',
    retry: false,
  })

  const { data: bookingFeeTypeSetting } = useQuery({
    queryKey: ['setting', 'booking_fee_type'],
    queryFn: () => settingsApi.get('booking_fee_type').catch(() => null),
    enabled: activeTab === 'settings',
    retry: false,
  })

  const { data: discountCodesEnabledSetting } = useQuery({
    queryKey: ['setting', 'discount_codes_enabled'],
    queryFn: () => settingsApi.get('discount_codes_enabled').catch(() => null),
    enabled: activeTab === 'settings',
    retry: false,
  })

  const { data: shopEnabledSetting } = useQuery({
    queryKey: ['setting', 'shop_enabled'],
    queryFn: async () => {
      const { data, error } = await supabase.from('settings').select('*').eq('key', 'shop_enabled').maybeSingle()
      if (error) throw error
      return data
    },
    enabled: activeTab === 'settings',
    retry: false,
  })

  const { data: communityEnabledSetting } = useQuery({
    queryKey: ['setting', 'community_enabled'],
    queryFn: () => settingsApi.get('community_enabled').catch(() => null),
    enabled: activeTab === 'settings',
    retry: false,
  })

  const { data: meditationEnabledSetting } = useQuery({
    queryKey: ['setting', 'meditation_enabled'],
    queryFn: () => settingsApi.get('meditation_enabled').catch(() => null),
    enabled: activeTab === 'settings',
    retry: false,
  })

  const { data: managerBulkUploadEnabledSetting } = useQuery({
    queryKey: ['setting', 'manager_bulk_upload_enabled'],
    queryFn: () => settingsApi.get('manager_bulk_upload_enabled').catch(() => null),
    enabled: activeTab === 'settings',
    retry: false,
  })

  const { data: enableSharingSetting } = useQuery({
    queryKey: ['setting', 'enable_sharing'],
    queryFn: () => settingsApi.get('enable_sharing').catch(() => null),
    enabled: activeTab === 'settings',
    retry: false,
  })

  const { data: enableGoogleWalletSetting } = useQuery({
    queryKey: ['setting', 'enable_google_wallet'],
    queryFn: () => settingsApi.get('enable_google_wallet').catch(() => null),
    enabled: activeTab === 'settings',
    retry: false,
  })

  const { data: enableAppleWalletSetting } = useQuery({
    queryKey: ['setting', 'enable_apple_wallet'],
    queryFn: () => settingsApi.get('enable_apple_wallet').catch(() => null),
    enabled: activeTab === 'settings',
    retry: false,
  })

  const { data: vitalityEnabledSetting } = useQuery({
    queryKey: ['setting', 'vitality_enabled'],
    queryFn: () => settingsApi.get('vitality_enabled').catch(() => null),
    enabled: activeTab === 'settings',
    retry: false,
  })

  const { data: useHealthConnectSetting } = useQuery({
    queryKey: ['setting', 'use_health_connect'],
    queryFn: () => settingsApi.get('use_health_connect').catch(() => null),
    enabled: activeTab === 'settings',
    retry: false,
  })

  const { data: verifiedMetricPointsSetting } = useQuery({
    queryKey: ['setting', 'vitality_verified_metric_points'],
    queryFn: () => settingsApi.get('vitality_verified_metric_points').catch(() => null),
    enabled: activeTab === 'settings',
    retry: false,
  })

  const { data: healthConnectDebugSetting } = useQuery({
    queryKey: ['setting', 'health_connect_debug'],
    queryFn: () => settingsApi.get('health_connect_debug').catch(() => null),
    enabled: activeTab === 'settings',
    retry: false,
  })

  const { data: ringDiagnosticsSetting } = useQuery({
    queryKey: ['setting', 'ring_diagnostics_enabled'],
    queryFn: () => settingsApi.get('ring_diagnostics_enabled').catch(() => null),
    enabled: activeTab === 'settings',
    retry: false,
  })

  const { data: vitalityChallengesSetting } = useQuery({
    queryKey: ['setting', 'vitality_challenges'],
    queryFn: () => settingsApi.get('vitality_challenges').catch(() => null),
    enabled: activeTab === 'settings',
    retry: false,
  })

  const { data: vitalityDataPartnersSetting } = useQuery({
    queryKey: ['setting', 'vitality_data_partners'],
    queryFn: () => settingsApi.get('vitality_data_partners').catch(() => null),
    enabled: activeTab === 'settings',
    retry: false,
  })

  const { data: vitalityYaugaRingSetting } = useQuery({
    queryKey: ['setting', 'vitality_yauga_ring'],
    queryFn: () => settingsApi.get('vitality_yauga_ring').catch(() => null),
    enabled: activeTab === 'settings',
    retry: false,
  })

  const { data: ringMetricGuidanceSetting } = useQuery({
    queryKey: ['setting', 'ring_metric_guidance'],
    queryFn: () => settingsApi.get('ring_metric_guidance').catch(() => null),
    enabled: activeTab === 'settings',
    retry: false,
  })

  const { data: vitalityHealthDevices = [] } = useQuery({
    queryKey: ['vitality-health-devices'],
    queryFn: () => vitalityApi.listHealthDevices(),
    enabled: activeTab === 'settings',
    retry: false,
  })

  // Registered entity settings
  const { data: registeredEntityNameSetting } = useQuery({
    queryKey: ['setting', 'registered_entity_name'],
    queryFn: () => settingsApi.get('registered_entity_name').catch(() => null),
    enabled: activeTab === 'settings',
    retry: false,
  })

  const { data: registeredEntityAddressSetting } = useQuery({
    queryKey: ['setting', 'registered_entity_address'],
    queryFn: () => settingsApi.get('registered_entity_address').catch(() => null),
    enabled: activeTab === 'settings',
    retry: false,
  })

  const { data: registeredEntityCompanyNumberSetting } = useQuery({
    queryKey: ['setting', 'registered_entity_company_number'],
    queryFn: () => settingsApi.get('registered_entity_company_number').catch(() => null),
    enabled: activeTab === 'settings',
    retry: false,
  })

  const { data: registeredEntityTaxNumberSetting } = useQuery({
    queryKey: ['setting', 'registered_entity_tax_number'],
    queryFn: () => settingsApi.get('registered_entity_tax_number').catch(() => null),
    enabled: activeTab === 'settings',
    retry: false,
  })

  // Loyalty section state
  const [showAwardPointsForm, setShowAwardPointsForm] = useState(false)
  const [awardPointsForm, setAwardPointsForm] = useState({
    userEmail: '',
    points: '',
    reason: '',
    awardToAll: false,
  })

  const { data: usersWithPoints = [] } = useQuery({
    queryKey: ['users-with-points'],
    queryFn: () => pointsApi.getAllUsersWithPoints(),
    enabled: activeTab === 'loyalty',
  })

  const awardPointsMutation = useMutation({
    mutationFn: async ({ email, points, reason, awardToAll }: { email: string | null; points: number; reason: string; awardToAll: boolean }) => {
      if (!userEmail) throw new Error('Not authenticated')
      return await pointsApi.awardPoints(awardToAll ? null : email, points, reason, userEmail)
    },
    onSuccess: (data) => {
      queryClient.invalidateQueries({ queryKey: ['users-with-points'] })
      toast.success(`Points awarded successfully to ${data.count} user(s)!`)
      setShowAwardPointsForm(false)
      setAwardPointsForm({ userEmail: '', points: '', reason: '', awardToAll: false })
    },
    onError: (error: any) => {
      toast.error(`Failed to award points: ${error.message || 'Unknown error'}`)
    },
  })

  const addEventImageFiles = (files: FileList | null) => {
    if (!files || files.length === 0) return

    const incoming = Array.from(files)
    setErrors((prev) => ({ ...prev, event_images: '' }))

    setEventImageDrafts((prev) => {
      const start = prev.length
      const newDrafts: NewEventImageDraft[] = incoming.map((file, i) => ({
        kind: 'new',
        file,
        preview_url: URL.createObjectURL(file),
        alt_text: '',
        display_order: start + i,
        orientation: 'landscape',
      }))
      return [...prev, ...newDrafts]
    })
  }

  const addLibraryPickFromLibrary = (lib: LocationLibraryImage) => {
    setErrors((prev) => ({ ...prev, event_images: '' }))
    setEventImageDrafts((prev) => {
      const already =
        prev.some(
          (d) =>
            (d.kind === 'library_pick' && d.library_image_id === lib.id) ||
            (d.kind === 'existing' && d.library_image_id === lib.id)
        )
      if (already) {
        toast.error('That image is already in this event’s list.')
        return prev
      }
      const display_order = prev.length
      const row: LibraryPickEventImageDraft = {
        kind: 'library_pick',
        library_image_id: lib.id,
        storage_path: lib.storage_path,
        image_url: lib.image_url,
        alt_text: lib.alt_text?.trim() ? lib.alt_text : lib.title,
        display_order,
        orientation: 'landscape',
      }
      return [...prev, row]
    })
    setLibraryPickerOpen(false)
    toast.success('Image added to this event')
  }

  const updateEventImageAltText = (index: number, nextAlt: string) => {
    setEventImageDrafts((prev) =>
      prev.map((d, i) => (i === index ? { ...d, alt_text: nextAlt } : d))
    )
  }

  const updateEventImageOrientation = (
    index: number,
    orientation: 'landscape' | 'portrait'
  ) => {
    setEventImageDrafts((prev) =>
      prev.map((d, i) => (i === index ? { ...d, orientation } : d))
    )
  }

  const moveEventImageDraft = (index: number, direction: -1 | 1) => {
    setEventImageDrafts((prev) => {
      if (prev.length <= 1) return prev
      const nextIndex = index + direction
      if (nextIndex < 0 || nextIndex >= prev.length) return prev

      const copy = [...prev]
      const [removed] = copy.splice(index, 1)
      copy.splice(nextIndex, 0, removed)

      return copy.map((d, i) => ({ ...d, display_order: i }))
    })
  }

  const removeEventImageDraft = (index: number) => {
    setEventImageDrafts((prev) => {
      if (index < 0 || index >= prev.length) return prev
      const copy = [...prev]
      const [removed] = copy.splice(index, 1)

      if (removed.kind === 'existing') {
        setDeletedEventImageDrafts((delPrev) => [
          ...delPrev,
          {
            id: removed.id,
            storage_path: removed.storage_path,
            delete_storage: !removed.library_image_id,
          },
        ])
      } else if (removed.kind === 'new') {
        URL.revokeObjectURL(removed.preview_url)
      }

      return copy.map((d, i) => ({ ...d, display_order: i }))
    })
  }

  const saveEventImagesForEvent = async (eventId: string) => {
    const draftsSnapshot = eventImageDrafts
    const deletedSnapshot = deletedEventImageDrafts

    const missingAlt = draftsSnapshot.some((d) => !d.alt_text.trim())
    if (missingAlt) {
      setErrors((prev) => ({
        ...prev,
        event_images: 'Alt text is required for every event image.',
      }))
      throw new Error('Missing alt text')
    }

    const hasLandscape = draftsSnapshot.some((d) => d.orientation === 'landscape')
    const hasPortrait = draftsSnapshot.some((d) => d.orientation === 'portrait')
    if (draftsSnapshot.length > 0 && (!hasLandscape || !hasPortrait)) {
      setErrors((prev) => ({
        ...prev,
        event_images: 'Add at least one landscape and one portrait image.',
      }))
      throw new Error('Missing landscape/portrait images')
    }

    setEventImagesUploading(true)
    try {
      if (deletedSnapshot.length > 0) {
        const ids = deletedSnapshot.map((d) => d.id)

        const { error: deleteRowsError } = await supabase.from('event_images').delete().in('id', ids)

        if (deleteRowsError) throw deleteRowsError

        const storagePaths = deletedSnapshot.filter((d) => d.delete_storage).map((d) => d.storage_path)
        if (storagePaths.length > 0) {
          const { error: deleteStorageError } = await supabase.storage.from('yauga').remove(storagePaths)
          if (deleteStorageError) throw deleteStorageError
        }
      }

      const existingDrafts = draftsSnapshot.filter((d) => d.kind === 'existing')
      const newDrafts = draftsSnapshot.filter((d) => d.kind === 'new')
      const libraryPickDrafts = draftsSnapshot.filter((d) => d.kind === 'library_pick')

      if (existingDrafts.length > 0) {
        const updatePromises = existingDrafts.map((img) =>
          supabase
            .from('event_images')
            .update({
              alt_text: img.alt_text.trim(),
              display_order: img.display_order,
              orientation: img.orientation,
            })
            .eq('id', img.id)
        )
        const updateResults = await Promise.all(updatePromises)
        const firstError = updateResults.find((r) => (r as any).error)?.error
        if (firstError) throw firstError
      }

      if (libraryPickDrafts.length > 0) {
        const { error: pickErr } = await supabase.from('event_images').insert(
          libraryPickDrafts.map((img) => ({
            event_id: eventId,
            storage_path: img.storage_path,
            image_url: img.image_url,
            alt_text: img.alt_text.trim(),
            display_order: img.display_order,
            library_image_id: img.library_image_id,
            orientation: img.orientation,
          }))
        )
        if (pickErr) throw pickErr
      }

      if (newDrafts.length > 0) {
        const libraryTitleBase = formData.city.trim() || 'Location'
        for (const img of newDrafts) {
          const fileExt = img.file.name.split('.').pop() || 'png'
          const libFileId = crypto.randomUUID()
          const objectPath = `location-library/${libFileId}.${fileExt}`

          const { data: uploadData, error: uploadError } = await supabase.storage
            .from('yauga')
            .upload(objectPath, img.file, {
              cacheControl: '3600',
              upsert: false,
            })

          if (uploadError) throw uploadError
          if (!uploadData?.path) throw new Error('Upload failed: missing storage path')

          const {
            data: { publicUrl },
          } = supabase.storage.from('yauga').getPublicUrl(uploadData.path)

          const alt = img.alt_text.trim()

          const { data: libRow, error: libInsertError } = await supabase
            .from('location_library_images')
            .insert({
              title: libraryTitleBase,
              storage_path: uploadData.path,
              image_url: publicUrl,
              alt_text: alt,
            })
            .select('id')
            .single()

          if (libInsertError) throw libInsertError
          if (!libRow?.id) throw new Error('Library insert failed')

          const { error: evImgErr } = await supabase.from('event_images').insert({
            event_id: eventId,
            storage_path: uploadData.path,
            image_url: publicUrl,
            alt_text: alt,
            display_order: img.display_order,
            library_image_id: libRow.id,
            orientation: img.orientation,
          })

          if (evImgErr) throw evImgErr
        }
      }

      queryClient.invalidateQueries({ queryKey: ['location-library-images'] })
      queryClient.invalidateQueries({ queryKey: ['event-images'] })
    } finally {
      setEventImagesUploading(false)
    }
  }

  const createEventMutation = useMutation({
    mutationFn: async (event: Omit<Event, 'id' | 'created_at' | 'updated_at' | 'registration_count'>) => {
      const result = await adminApi.createEvent(event)
      return result
    },
    onSuccess: async (createdEvent) => {
      queryClient.invalidateQueries({ queryKey: ['admin-events'] })
      queryClient.invalidateQueries({ queryKey: ['admin-events', userEmail] })
      toast.success('Event created successfully!')
      try {
        await saveEventImagesForEvent(createdEvent.id)
      } catch (e: any) {
        console.error('Failed to save event images:', e)
        toast.error(e?.message || 'Event saved, but event images could not be saved.')
      }
      if (eventEditor) {
        leaveEventEditorToAdmin()
        return
      }
      setWalletHeroFile(null)
      setWalletStrip1xFile(null)
      setWalletStrip2xFile(null)
      setWalletStrip3xFile(null)
      handleCancelEdit()
    },
    onError: (error: any) => {
      console.error('Error creating event:', error)
      toast.error('Failed to create event: ' + (error.message || 'Unknown error. Check console for details.'))
    },
  })

  const updateEventMutation = useMutation({
    mutationFn: ({ id, updates }: { id: string; updates: Partial<Event> }) =>
      adminApi.updateEvent(id, updates),
    onSuccess: async (updatedEvent) => {
      queryClient.invalidateQueries({ queryKey: ['admin-events'] })
      queryClient.invalidateQueries({ queryKey: ['admin-events', userEmail] })
      queryClient.invalidateQueries({ queryKey: ['event-tickets'] })
      toast.success('Event updated successfully!')
      try {
        await saveEventImagesForEvent(updatedEvent.id)
      } catch (e: any) {
        console.error('Failed to save event images:', e)
        toast.error(e?.message || 'Event updated, but event images could not be saved.')
      }
      if (eventEditor) {
        leaveEventEditorToAdmin()
        return
      }
      handleCancelEdit()
    },
    onError: (error: any) => {
      toast.error(error.message || 'Failed to update event')
    },
  })

  const toggleEventFeaturedMutation = useMutation({
    mutationFn: ({ id, is_featured }: { id: string; is_featured: boolean }) =>
      adminApi.updateEvent(id, { is_featured }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['admin-events'] })
      queryClient.invalidateQueries({ queryKey: ['admin-events-featured-eligible'] })
      queryClient.invalidateQueries({ queryKey: ['events', 'home-featured'] })
      toast.success('Featured setting updated')
    },
    onError: (error: any) => {
      toast.error(error?.message || 'Failed to update featured flag')
    },
  })

  type OpenEventPayload =
    | string
    | { eventId: string; earlyBookingIncentive?: { numberOfBookings: number; discountPercent: number; code: string } }
  const openEventMutation = useMutation({
    mutationFn: async (payload: OpenEventPayload) => {
      const eventId = typeof payload === 'string' ? payload : payload.eventId
      const earlyBookingIncentive = typeof payload === 'string' ? undefined : payload.earlyBookingIncentive
      // Validate hybrid events have link, details and price before opening
      const event = await adminApi.getEventById(eventId).catch(() => null)
      if (event?.event_type === 'hybrid') {
        const hybridLink = (event.hybrid_link ?? '').toString().trim()
        const hybridDetails = (event.hybrid_details ?? '').toString().trim()
        const hybridPriceSet = event.hybrid_price_pence != null && typeof event.hybrid_price_pence === 'number'
        if (!hybridLink || !hybridDetails || !hybridPriceSet) {
          const missing: string[] = []
          if (!hybridLink) missing.push('Hybrid link')
          if (!hybridDetails) missing.push('Hybrid details')
          if (!hybridPriceSet) missing.push('Hybrid price')
          throw new Error(`Hybrid events require: ${missing.join(', ')}. Please complete these before opening.`)
        }
      }
      // Step 1: Update event status directly (this works reliably)
      await adminApi.updateEvent(eventId, { status: 'open' })

      // Step 2: Try to send emails via edge function (non-blocking)
      // If this fails, event is still opened
      let notified = 0
      try {
        const responseData = await adminApi.openEvent(eventId, earlyBookingIncentive)
        notified = responseData?.emailsSent || responseData?.notified || 0

        if (responseData?.totalPreRegistrations === 0) {
          console.warn('No pre-registrations found for this event')
        } else if (responseData?.emailsFailed > 0) {
          console.warn('Some emails failed:', responseData.errors)
        }
      } catch (emailError) {
        console.warn('Email notification error (non-critical):', emailError)
        // Don't throw - event is already opened
      }

      return { success: true, notified }
    },
    onSuccess: (data) => {
      queryClient.invalidateQueries({ queryKey: ['admin-events'] })
      queryClient.invalidateQueries({ queryKey: ['admin-events', userEmail] })
      if (data.notified > 0) {
        toast.success(`Event opened! ${data.notified} email${data.notified !== 1 ? 's' : ''} sent to pre-registrants.`)
      } else {
        toast.success('Event opened! (No pre-registrations to notify or email sending failed - check console for details)')
      }
    },
    onError: (error: any) => {
      console.error('Error opening event:', error)
      toast.error(`Failed to open event: ${error.message || 'Unknown error'}`)
    },
  })

  const createCarouselItemMutation = useMutation({
    mutationFn: (item: Omit<CarouselItem, 'id' | 'created_at' | 'updated_at'>) =>
      carouselApi.create(item),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['carousel-items'] })
      queryClient.invalidateQueries({ queryKey: ['carousel-items-all'] })
      setShowCarouselForm(false)
      setCarouselFormData({
        image_url: '',
        headline: '',
        description: '',
        title: '',
        article: '',
        seo_title: '',
        seo_description: '',
        seo_keywords: '',
        seo_slug: '',
        cta1_label: '',
        cta1_url: '',
        cta2_label: '',
        cta2_url: '',
        placement: 'homepage' as CarouselPlacement,
        orientation: 'landscape' as CarouselOrientation,
        display_order: 0,
        is_active: true,
      })
      setEditingCarouselItem(null)
      toast.success('Carousel item created successfully!')
    },
    onError: (error: any) => {
      toast.error(`Failed to create carousel item: ${error.message || 'Unknown error'}`)
    },
  })

  const updateCarouselItemMutation = useMutation({
    mutationFn: ({ id, updates }: { id: string; updates: Partial<CarouselItem> }) =>
      carouselApi.update(id, updates),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['carousel-items'] })
      queryClient.invalidateQueries({ queryKey: ['carousel-items-all'] })
      setShowCarouselForm(false)
      setEditingCarouselItem(null)
      setCarouselImageFile(null)
      setCarouselImagePreview('')
      setCarouselFormData({
        image_url: '',
        headline: '',
        description: '',
        title: '',
        article: '',
        seo_title: '',
        seo_description: '',
        seo_keywords: '',
        seo_slug: '',
        cta1_label: '',
        cta1_url: '',
        cta2_label: '',
        cta2_url: '',
        placement: 'homepage' as CarouselPlacement,
        orientation: 'landscape' as CarouselOrientation,
        display_order: 0,
        is_active: true,
      })
      setUploadingImage(false)
      toast.success('Carousel item updated successfully!')
    },
    onError: (error: any) => {
      toast.error(`Failed to update carousel item: ${error.message || 'Unknown error'}`)
    },
  })

  const deleteCarouselItemMutation = useMutation({
    mutationFn: (id: string) => carouselApi.delete(id),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['carousel-items'] })
      queryClient.invalidateQueries({ queryKey: ['carousel-items-all'] })
      toast.success('Carousel item deleted successfully!')
    },
    onError: (error: any) => {
      toast.error(`Failed to delete carousel item: ${error.message || 'Unknown error'}`)
    },
  })

  const deleteTestEventMutation = useMutation({
    mutationFn: ({ id, email }: { id: string; email: string }) => adminApi.deleteTestEvent(id, email),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['admin-events'] })
      queryClient.invalidateQueries({ queryKey: ['admin-events', userEmail] })
      setTestBookingDelete(null)
      toast.success('Test booking and event deleted')
    },
    onError: (error: any) => {
      const message = String(error?.message || 'Failed to delete test booking')
      toast.error(message.replace(/^.*admin_delete_test_event:\s*/i, ''))
    },
  })

  const deleteEventMutation = useMutation({
    mutationFn: (id: string) => adminApi.deleteEvent(id),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['admin-events'] })
      queryClient.invalidateQueries({ queryKey: ['admin-events', userEmail] })
      toast.success('Event deleted successfully!')
    },
    onError: (error: any) => {
      toast.error(`Failed to delete event: ${error.message || 'Unknown error'}`)
    },
  })

  const createFAQMutation = useMutation({
    mutationFn: (item: Omit<FAQ, 'id' | 'created_at' | 'updated_at'>) =>
      faqApi.create(item),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['faqs'] })
      queryClient.invalidateQueries({ queryKey: ['faqs-all'] })
      setShowFAQForm(false)
      setFAQFormData({
        question: '',
        answer: '',
        display_order: 0,
        is_active: true,
      })
      setEditingFAQ(null)
      toast.success('FAQ created successfully!')
    },
    onError: (error: any) => {
      toast.error(`Failed to create FAQ: ${error.message || 'Unknown error'}`)
    },
  })

  const updateFAQMutation = useMutation({
    mutationFn: ({ id, updates }: { id: string; updates: Partial<FAQ> }) =>
      faqApi.update(id, updates),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['faqs'] })
      queryClient.invalidateQueries({ queryKey: ['faqs-all'] })
      setShowFAQForm(false)
      setEditingFAQ(null)
      setFAQFormData({
        question: '',
        answer: '',
        display_order: 0,
        is_active: true,
      })
      toast.success('FAQ updated successfully!')
    },
    onError: (error: any) => {
      toast.error(`Failed to update FAQ: ${error.message || 'Unknown error'}`)
    },
  })

  const deleteFAQMutation = useMutation({
    mutationFn: (id: string) => faqApi.delete(id),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['faqs'] })
      queryClient.invalidateQueries({ queryKey: ['faqs-all'] })
      toast.success('FAQ deleted successfully!')
    },
    onError: (error: any) => {
      toast.error(`Failed to delete FAQ: ${error.message || 'Unknown error'}`)
    },
  })

  const updateLegalPageMutation = useMutation({
    mutationFn: ({ pageType, content }: { pageType: 'privacy' | 'terms' | 'cookies' | 'event_requirements' | 'about'; content: string }) =>
      legalPagesApi.update(pageType, content),
    onSuccess: (_, variables) => {
      queryClient.invalidateQueries({ queryKey: ['legal-page', variables.pageType] })
      toast.success('Legal page updated successfully!')
      setLegalPageType(null)
      setLegalPageContent('')
    },
    onError: (error: any) => {
      toast.error(`Failed to update legal page: ${error.message || 'Unknown error'}`)
    },
  })

  const handleLegalPageSelect = async (pageType: 'privacy' | 'terms' | 'cookies' | 'event_requirements' | 'about') => {
    setAboutImageLayoutOpen(null)
    setLegalPageType(pageType)
    try {
      const page = await legalPagesApi.getByType(pageType)
      setLegalPageContent(page.content)
    } catch (error: any) {
      // If page doesn't exist yet (e.g., new About page), set empty content
      if (error.message?.includes('not found') || error.message?.includes('No rows')) {
        setLegalPageContent('')
      } else {
        toast.error(`Failed to load page: ${error.message || 'Unknown error'}`)
      }
    }
  }

  const handleLegalPageSubmit = (e: React.FormEvent) => {
    e.preventDefault()
    if (!legalPageType) return
    updateLegalPageMutation.mutate({ pageType: legalPageType, content: legalPageContent })
  }

  const [brandNameInput, setBrandNameInput] = useState('')
  const [socialXUrlInput, setSocialXUrlInput] = useState('')
  const [socialInstagramUrlInput, setSocialInstagramUrlInput] = useState('')
  const [socialTiktokUrlInput, setSocialTiktokUrlInput] = useState('')
  const [adminEmail, setAdminEmail] = useState('')
  const [emailFrom, setEmailFrom] = useState('')
  const [legalEmailInput, setLegalEmailInput] = useState('')
  const [carouselDelay, setCarouselDelay] = useState('5000')
  const [homepageEventsLimitInput, setHomepageEventsLimitInput] = useState('15')
  const [featuredEventsPerSlide, setFeaturedEventsPerSlide] = useState<'2' | '3'>('2')
  const [bookingFeeEnabled, setBookingFeeEnabled] = useState(false)
  const [bookingFee, setBookingFee] = useState('0')
  const [bookingFeeType, setBookingFeeType] = useState<'fixed' | 'percentage'>('fixed')
  const [discountCodesEnabled, setDiscountCodesEnabled] = useState(false)
  const [shopEnabled, setShopEnabled] = useState(true)
  const [communityEnabled, setCommunityEnabled] = useState(true)
  const [meditationEnabled, setMeditationEnabled] = useState(true)
  const [managerBulkUploadEnabled, setManagerBulkUploadEnabled] = useState(false)
  const [enableSharing, setEnableSharing] = useState(false)
  const [enableGoogleWallet, setEnableGoogleWallet] = useState(false)
  const [enableAppleWallet, setEnableAppleWallet] = useState(false)
  const [vitalityEnabled, setVitalityEnabled] = useState(false)
  const [useHealthConnect, setUseHealthConnect] = useState(false)
  const [verifiedMetricPointsDraft, setVerifiedMetricPointsDraft] = useState(() =>
    parseVerifiedMetricPointsSetting(null)
  )
  const [healthConnectDebug, setHealthConnectDebug] = useState(false)
  const [ringDiagnosticsEnabled, setRingDiagnosticsEnabled] = useState(false)
  const [vitalityChallengesDraft, setVitalityChallengesDraft] = useState(() =>
    parseVitalityChallengesSetting(null)
  )
  const [vitalityPartnersDraft, setVitalityPartnersDraft] = useState<VitalityDataPartner[]>(() =>
    parseVitalityDataPartners(null)
  )
  const [vitalityYaugaRingDraft, setVitalityYaugaRingDraft] = useState(() =>
    parseVitalityYaugaRingSetting(null)
  )
  const [ringMetricGuidanceDraft, setRingMetricGuidanceDraft] = useState(() =>
    parseRingMetricGuidance(null)
  )
  const [vitalityDevicesDraft, setVitalityDevicesDraft] = useState<
    Array<{ package_name: string; display_name: string }>
  >([])
  const [newDevicePackage, setNewDevicePackage] = useState('')
  const [newDeviceName, setNewDeviceName] = useState('')
  const [registeredEntityName, setRegisteredEntityName] = useState('')
  const [registeredEntityAddress, setRegisteredEntityAddress] = useState('')
  const [registeredEntityCompanyNumber, setRegisteredEntityCompanyNumber] = useState('')
  const [registeredEntityTaxNumber, setRegisteredEntityTaxNumber] = useState('')
  const [settingsBrandOpen, setSettingsBrandOpen] = useState(true)
  const [settingsAnalyticsOpen, setSettingsAnalyticsOpen] = useState(false)
  const [settingsShopOpen, setSettingsShopOpen] = useState(false)
  const [settingsMeditationOpen, setSettingsMeditationOpen] = useState(false)
  const [settingsChatbotOpen, setSettingsChatbotOpen] = useState(false)
  const [settingsRingOpen, setSettingsRingOpen] = useState(false)
  const [settingsManagerBulkOpen, setSettingsManagerBulkOpen] = useState(false)
  const [settingsTaxRatesOpen, setSettingsTaxRatesOpen] = useState(false)
  // Manager modal state is defined above with other modal state

  useEffect(() => {
    if (brandNameSetting) {
      setBrandNameInput(brandNameSetting.value)
    }
  }, [brandNameSetting])

  useEffect(() => {
    if (socialXUrlSetting) setSocialXUrlInput(socialXUrlSetting.value)
  }, [socialXUrlSetting])
  useEffect(() => {
    if (socialInstagramUrlSetting) setSocialInstagramUrlInput(socialInstagramUrlSetting.value)
  }, [socialInstagramUrlSetting])
  useEffect(() => {
    if (socialTiktokUrlSetting) setSocialTiktokUrlInput(socialTiktokUrlSetting.value)
  }, [socialTiktokUrlSetting])

  useEffect(() => {
    if (adminEmailSetting) {
      setAdminEmail(adminEmailSetting.value)
    }
  }, [adminEmailSetting])

  useEffect(() => {
    if (emailFromSetting) {
      setEmailFrom(emailFromSetting.value)
    }
  }, [emailFromSetting])

  useEffect(() => {
    if (legalEmailSetting) {
      setLegalEmailInput(legalEmailSetting.value)
    }
  }, [legalEmailSetting])

  useEffect(() => {
    if (carouselDelaySetting) {
      setCarouselDelay(carouselDelaySetting.value)
    }
  }, [carouselDelaySetting])

  useEffect(() => {
    if (homepageEventsLimitSetting) {
      setHomepageEventsLimitInput(homepageEventsLimitSetting.value)
    }
  }, [homepageEventsLimitSetting])

  useEffect(() => {
    if (featuredEventsPerSlideSetting) {
      const v = featuredEventsPerSlideSetting.value === '3' ? '3' : '2'
      setFeaturedEventsPerSlide(v)
    }
  }, [featuredEventsPerSlideSetting])

  useEffect(() => {
    if (bookingFeeEnabledSetting) {
      setBookingFeeEnabled(bookingFeeEnabledSetting.value === 'true')
    }
  }, [bookingFeeEnabledSetting])

  useEffect(() => {
    if (bookingFeeSetting) {
      setBookingFee(bookingFeeSetting.value)
    }
  }, [bookingFeeSetting])

  useEffect(() => {
    if (bookingFeeTypeSetting?.value === 'percentage' || bookingFeeTypeSetting?.value === 'fixed') {
      setBookingFeeType(bookingFeeTypeSetting.value as 'fixed' | 'percentage')
    }
  }, [bookingFeeTypeSetting])

  useEffect(() => {
    if (discountCodesEnabledSetting) {
      setDiscountCodesEnabled(discountCodesEnabledSetting.value === 'true')
    }
  }, [discountCodesEnabledSetting])

  useEffect(() => {
    if (shopEnabledSetting) {
      setShopEnabled(shopEnabledSetting.value === 'true')
    }
  }, [shopEnabledSetting])

  useEffect(() => {
    if (communityEnabledSetting) {
      setCommunityEnabled(communityEnabledSetting.value === 'true')
    }
  }, [communityEnabledSetting])

  useEffect(() => {
    if (meditationEnabledSetting) {
      setMeditationEnabled(meditationEnabledSetting.value === 'true')
    }
  }, [meditationEnabledSetting])

  useEffect(() => {
    if (managerBulkUploadEnabledSetting) {
      setManagerBulkUploadEnabled(managerBulkUploadEnabledSetting.value === 'true')
    }
  }, [managerBulkUploadEnabledSetting])

  useEffect(() => {
    if (enableSharingSetting) {
      setEnableSharing(enableSharingSetting.value === 'true')
    }
  }, [enableSharingSetting])

  useEffect(() => {
    if (enableGoogleWalletSetting) {
      setEnableGoogleWallet(enableGoogleWalletSetting.value === 'true')
    }
  }, [enableGoogleWalletSetting])

  useEffect(() => {
    if (enableAppleWalletSetting) {
      setEnableAppleWallet(enableAppleWalletSetting.value === 'true')
    }
  }, [enableAppleWalletSetting])

  useEffect(() => {
    if (vitalityEnabledSetting) {
      setVitalityEnabled(vitalityEnabledSetting.value === 'true')
    }
  }, [vitalityEnabledSetting])

  useEffect(() => {
    if (useHealthConnectSetting) {
      setUseHealthConnect(useHealthConnectSetting.value === 'true')
    }
  }, [useHealthConnectSetting])

  useEffect(() => {
    if (verifiedMetricPointsSetting?.value != null) {
      setVerifiedMetricPointsDraft(
        parseVerifiedMetricPointsSetting(verifiedMetricPointsSetting.value)
      )
    } else if (verifiedMetricPointsSetting === null) {
      setVerifiedMetricPointsDraft(parseVerifiedMetricPointsSetting(null))
    }
  }, [verifiedMetricPointsSetting])

  useEffect(() => {
    if (healthConnectDebugSetting) {
      setHealthConnectDebug(healthConnectDebugSetting.value === 'true')
    }
  }, [healthConnectDebugSetting])

  useEffect(() => {
    if (ringDiagnosticsSetting) {
      setRingDiagnosticsEnabled(ringDiagnosticsSetting.value === 'true')
    }
  }, [ringDiagnosticsSetting])

  useEffect(() => {
    if (vitalityChallengesSetting?.value != null) {
      setVitalityChallengesDraft(parseVitalityChallengesSetting(vitalityChallengesSetting.value))
    } else if (vitalityChallengesSetting === null) {
      setVitalityChallengesDraft(parseVitalityChallengesSetting(null))
    }
  }, [vitalityChallengesSetting])

  useEffect(() => {
    if (vitalityDataPartnersSetting?.value != null) {
      setVitalityPartnersDraft(parseVitalityDataPartners(vitalityDataPartnersSetting.value))
    } else if (vitalityDataPartnersSetting === null) {
      setVitalityPartnersDraft(parseVitalityDataPartners(null))
    }
  }, [vitalityDataPartnersSetting])

  useEffect(() => {
    if (vitalityYaugaRingSetting?.value != null) {
      setVitalityYaugaRingDraft(parseVitalityYaugaRingSetting(vitalityYaugaRingSetting.value))
    } else if (vitalityYaugaRingSetting === null) {
      setVitalityYaugaRingDraft(parseVitalityYaugaRingSetting(null))
    }
  }, [vitalityYaugaRingSetting])

  useEffect(() => {
    if (ringMetricGuidanceSetting?.value != null) {
      setRingMetricGuidanceDraft(parseRingMetricGuidance(ringMetricGuidanceSetting.value))
    } else if (ringMetricGuidanceSetting === null) {
      setRingMetricGuidanceDraft(parseRingMetricGuidance(null))
    }
  }, [ringMetricGuidanceSetting])

  useEffect(() => {
    setVitalityDevicesDraft(
      (vitalityHealthDevices as VitalityHealthDevice[]).map((d) => ({
        package_name: d.package_name,
        display_name: d.display_name || '',
      }))
    )
  }, [vitalityHealthDevices])

  useEffect(() => {
    if (registeredEntityNameSetting) {
      setRegisteredEntityName(registeredEntityNameSetting.value)
    }
  }, [registeredEntityNameSetting])

  useEffect(() => {
    if (registeredEntityAddressSetting) {
      setRegisteredEntityAddress(registeredEntityAddressSetting.value)
    }
  }, [registeredEntityAddressSetting])

  useEffect(() => {
    if (registeredEntityCompanyNumberSetting) {
      setRegisteredEntityCompanyNumber(registeredEntityCompanyNumberSetting.value)
    }
  }, [registeredEntityCompanyNumberSetting])

  useEffect(() => {
    if (registeredEntityTaxNumberSetting) {
      setRegisteredEntityTaxNumber(registeredEntityTaxNumberSetting.value)
    }
  }, [registeredEntityTaxNumberSetting])

  const updateAdminEmailMutation = useMutation({
    mutationFn: (email: string) => settingsApi.update('admin_email', email),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['setting', 'admin_email'] })
      toast.success('Admin email updated successfully!')
    },
    onError: (error: any) => {
      toast.error(`Failed to update admin email: ${error.message || 'Unknown error'}`)
    },
  })

  const updateEmailFromMutation = useMutation({
    mutationFn: (value: string) => settingsApi.update('email_from', value),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['setting', 'email_from'] })
      toast.success('Email From updated successfully!')
    },
    onError: (error: any) => {
      toast.error(`Failed to update Email From: ${error.message || 'Unknown error'}`)
    },
  })

  const updateLegalEmailMutation = useMutation({
    mutationFn: (value: string) => settingsApi.update('legal_email', value),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['setting', 'legal_email'] })
      toast.success('Legal email updated successfully!')
    },
    onError: (error: any) => {
      toast.error(`Failed to update legal email: ${error.message || 'Unknown error'}`)
    },
  })

  const updateBrandNameMutation = useMutation({
    mutationFn: (name: string) => settingsApi.update('brand_name', name),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['setting', 'brand_name'] })
      toast.success('Brand name updated successfully!')
    },
    onError: (error: any) => {
      toast.error(`Failed to update brand name: ${error.message || 'Unknown error'}`)
    },
  })

  const updateSocialXUrlMutation = useMutation({
    mutationFn: (value: string) => settingsApi.update('social_x_url', value),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['setting', 'social_x_url'] })
      toast.success('X URL updated successfully!')
    },
    onError: (error: any) => {
      toast.error(`Failed to update X URL: ${error.message || 'Unknown error'}`)
    },
  })
  const updateSocialInstagramUrlMutation = useMutation({
    mutationFn: (value: string) => settingsApi.update('social_instagram_url', value),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['setting', 'social_instagram_url'] })
      toast.success('Instagram URL updated successfully!')
    },
    onError: (error: any) => {
      toast.error(`Failed to update Instagram URL: ${error.message || 'Unknown error'}`)
    },
  })
  const updateSocialTiktokUrlMutation = useMutation({
    mutationFn: (value: string) => settingsApi.update('social_tiktok_url', value),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['setting', 'social_tiktok_url'] })
      toast.success('TikTok URL updated successfully!')
    },
    onError: (error: any) => {
      toast.error(`Failed to update TikTok URL: ${error.message || 'Unknown error'}`)
    },
  })

  const updateCarouselDelayMutation = useMutation({
    mutationFn: (delay: string) => settingsApi.update('carousel_delay', delay),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['setting', 'carousel_delay'] })
      toast.success('Carousel delay updated successfully!')
    },
    onError: (error: any) => {
      toast.error(`Failed to update carousel delay: ${error.message || 'Unknown error'}`)
    },
  })

  const updateHomepageEventsLimitMutation = useMutation({
    mutationFn: (value: string) => settingsApi.update('homepage_events_limit', value),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['setting', 'homepage_events_limit'] })
      queryClient.invalidateQueries({ queryKey: ['events'] })
      toast.success('Homepage events limit updated.')
    },
    onError: (error: any) => {
      toast.error(`Failed to update homepage events limit: ${error.message || 'Unknown error'}`)
    },
  })

  const updateFeaturedEventsPerSlideMutation = useMutation({
    mutationFn: (value: '2' | '3') => settingsApi.update('featured_events_per_slide', value),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['setting', 'featured_events_per_slide'] })
      toast.success('Featured events carousel updated.')
    },
    onError: (error: any) => {
      toast.error(`Failed to update featured events setting: ${error.message || 'Unknown error'}`)
    },
  })

  const updateBookingFeeEnabledMutation = useMutation({
    mutationFn: (enabled: boolean) => settingsApi.update('booking_fee_enabled', enabled.toString()),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['setting', 'booking_fee_enabled'] })
      toast.success('Booking fee setting updated successfully!')
    },
    onError: (error: any) => {
      toast.error(`Failed to update booking fee setting: ${error.message || 'Unknown error'}`)
    },
  })

  const updateBookingFeeMutation = useMutation({
    mutationFn: (fee: string) => settingsApi.update('booking_fee', fee),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['setting', 'booking_fee'] })
      toast.success('Booking fee updated successfully!')
    },
    onError: (error: any) => {
      toast.error(`Failed to update booking fee: ${error.message || 'Unknown error'}`)
    },
  })

  const updateBookingFeeTypeMutation = useMutation({
    mutationFn: (type: 'fixed' | 'percentage') => settingsApi.update('booking_fee_type', type),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['setting', 'booking_fee_type'] })
      toast.success('Booking fee type updated!')
    },
    onError: (error: any) => {
      toast.error(`Failed to update booking fee type: ${error.message || 'Unknown error'}`)
    },
  })

  const updateDiscountCodesEnabledMutation = useMutation({
    mutationFn: (enabled: boolean) => settingsApi.update('discount_codes_enabled', enabled.toString()),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['setting', 'discount_codes_enabled'] })
      toast.success('Discount codes setting updated successfully!')
    },
    onError: (error: any) => {
      toast.error(`Failed to update discount codes setting: ${error.message || 'Unknown error'}`)
    },
  })

  const updateShopEnabledMutation = useMutation({
    mutationFn: (enabled: boolean) => settingsApi.update('shop_enabled', enabled.toString()),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['setting', 'shop_enabled'] })
      toast.success('Shop setting updated.')
    },
    onError: (error: any) => {
      toast.error(`Failed to update shop setting: ${error.message || 'Unknown error'}`)
    },
  })

  const updateCommunityEnabledMutation = useMutation({
    mutationFn: (enabled: boolean) => settingsApi.update('community_enabled', enabled.toString()),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['setting', 'community_enabled'] })
      toast.success('Community setting updated.')
    },
    onError: (error: any) => {
      toast.error(`Failed to update community setting: ${error.message || 'Unknown error'}`)
    },
  })

  const updateMeditationEnabledMutation = useMutation({
    mutationFn: (enabled: boolean) => settingsApi.update('meditation_enabled', enabled.toString()),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['setting', 'meditation_enabled'] })
      toast.success('Meditation setting updated.')
    },
    onError: (error: any) => {
      toast.error(`Failed to update meditation setting: ${error.message || 'Unknown error'}`)
    },
  })

  const updateManagerBulkUploadEnabledMutation = useMutation({
    mutationFn: (enabled: boolean) => settingsApi.update('manager_bulk_upload_enabled', enabled.toString()),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['setting', 'manager_bulk_upload_enabled'] })
      toast.success('Manager bulk upload setting updated successfully!')
    },
    onError: (error: any) => {
      toast.error(`Failed to update manager bulk upload setting: ${error.message || 'Unknown error'}`)
    },
  })

  const updateEnableSharingMutation = useMutation({
    mutationFn: (enabled: boolean) => settingsApi.update('enable_sharing', enabled.toString()),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['setting', 'enable_sharing'] })
      toast.success('Sharing setting updated successfully!')
    },
    onError: (error: any) => {
      toast.error(`Failed to update sharing setting: ${error.message || 'Unknown error'}`)
    },
  })

  const updateEnableGoogleWalletMutation = useMutation({
    mutationFn: (enabled: boolean) => settingsApi.update('enable_google_wallet', enabled.toString()),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['setting', 'enable_google_wallet'] })
      toast.success('Google Wallet setting updated successfully!')
    },
    onError: (error: any) => {
      toast.error(`Failed to update Google Wallet setting: ${error.message || 'Unknown error'}`)
    },
  })

  const updateEnableAppleWalletMutation = useMutation({
    mutationFn: (enabled: boolean) => settingsApi.update('enable_apple_wallet', enabled.toString()),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['setting', 'enable_apple_wallet'] })
      toast.success('Apple Wallet setting updated successfully!')
    },
    onError: (error: any) => {
      toast.error(`Failed to update Apple Wallet setting: ${error.message || 'Unknown error'}`)
    },
  })

  const updateVitalityEnabledMutation = useMutation({
    mutationFn: (enabled: boolean) => settingsApi.update('vitality_enabled', enabled.toString()),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['setting', 'vitality_enabled'] })
      toast.success('Yauga State setting updated successfully!')
    },
    onError: (error: any) => {
      toast.error(`Failed to update Vitality setting: ${error.message || 'Unknown error'}`)
    },
  })

  const updateUseHealthConnectMutation = useMutation({
    mutationFn: (enabled: boolean) => settingsApi.update('use_health_connect', enabled.toString()),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['setting', 'use_health_connect'] })
      toast.success('Health Connect setting updated!')
    },
    onError: (error: any) => {
      toast.error(`Failed to update Health Connect setting: ${error.message || 'Unknown error'}`)
    },
  })

  const updateVerifiedMetricPointsMutation = useMutation({
    mutationFn: (config: ReturnType<typeof parseVerifiedMetricPointsSetting>) =>
      settingsApi.update(
        'vitality_verified_metric_points',
        serializeVerifiedMetricPointsSetting(config)
      ),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['setting', 'vitality_verified_metric_points'] })
      toast.success('Verified metric points saved!')
    },
    onError: (error: any) => {
      toast.error(`Failed to save verified metric points: ${error.message || 'Unknown error'}`)
    },
  })

  const updateHealthConnectDebugMutation = useMutation({
    mutationFn: (enabled: boolean) => settingsApi.update('health_connect_debug', enabled.toString()),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['setting', 'health_connect_debug'] })
      toast.success('Health Connect debug setting updated successfully!')
    },
    onError: (error: any) => {
      toast.error(`Failed to update Health Connect debug setting: ${error.message || 'Unknown error'}`)
    },
  })

  const updateRingDiagnosticsMutation = useMutation({
    mutationFn: (enabled: boolean) =>
      settingsApi.update('ring_diagnostics_enabled', enabled.toString()),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['setting', 'ring_diagnostics_enabled'] })
      toast.success('Ring Diagnostics setting updated!')
    },
    onError: (error: any) => {
      toast.error(`Failed to update Ring Diagnostics setting: ${error.message || 'Unknown error'}`)
    },
  })

  const updateVitalityChallengesMutation = useMutation({
    mutationFn: (config: ReturnType<typeof parseVitalityChallengesSetting>) =>
      settingsApi.update('vitality_challenges', serializeVitalityChallengesSetting(config)),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['setting', 'vitality_challenges'] })
      queryClient.invalidateQueries({ queryKey: ['vitality-challenges'] })
      toast.success('Vitality weekly challenges saved!')
    },
    onError: (error: any) => {
      toast.error(`Failed to save vitality challenges: ${error.message || 'Unknown error'}`)
    },
  })

  const updateVitalityPartnersMutation = useMutation({
    mutationFn: (partners: VitalityDataPartner[]) =>
      settingsApi.update('vitality_data_partners', serializeVitalityDataPartners(partners)),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['setting', 'vitality_data_partners'] })
      queryClient.invalidateQueries({ queryKey: ['vitality-data-partners'] })
      toast.success('Vitality data partners saved!')
    },
    onError: (error: any) => {
      toast.error(`Failed to save data partners: ${error.message || 'Unknown error'}`)
    },
  })

  const updateVitalityYaugaRingMutation = useMutation({
    mutationFn: (config: ReturnType<typeof parseVitalityYaugaRingSetting>) =>
      settingsApi.update('vitality_yauga_ring', serializeVitalityYaugaRingSetting(config)),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['setting', 'vitality_yauga_ring'] })
      toast.success('Yauga Ring package setting saved!')
    },
    onError: (error: any) => {
      toast.error(`Failed to save Yauga Ring setting: ${error.message || 'Unknown error'}`)
    },
  })

  const updateRingMetricGuidanceMutation = useMutation({
    mutationFn: (config: ReturnType<typeof parseRingMetricGuidance>) =>
      settingsApi.update('ring_metric_guidance', serializeRingMetricGuidance(config)),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['setting', 'ring_metric_guidance'] })
      toast.success('Ring reading guidance saved!')
    },
    onError: (error: any) => {
      toast.error(`Failed to save ring reading guidance: ${error.message || 'Unknown error'}`)
    },
  })

  const saveVitalityDevicesMutation = useMutation({
    mutationFn: async (rows: Array<{ package_name: string; display_name: string }>) => {
      for (const row of rows) {
        await vitalityApi.upsertHealthDevice({
          packageName: row.package_name,
          displayName: row.display_name.trim() || null,
        })
      }
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['vitality-health-devices'] })
      toast.success('Health Connect devices saved!')
    },
    onError: (error: any) => {
      toast.error(`Failed to save devices: ${error.message || 'Unknown error'}`)
    },
  })

  const updateRegisteredEntityNameMutation = useMutation({
    mutationFn: (name: string) => settingsApi.update('registered_entity_name', name),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['setting', 'registered_entity_name'] })
      toast.success('Registered entity name updated successfully!')
    },
    onError: (error: any) => {
      toast.error(`Failed to update registered entity name: ${error.message || 'Unknown error'}`)
    },
  })

  const updateRegisteredEntityAddressMutation = useMutation({
    mutationFn: (address: string) => settingsApi.update('registered_entity_address', address),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['setting', 'registered_entity_address'] })
      toast.success('Registered entity address updated successfully!')
    },
    onError: (error: any) => {
      toast.error(`Failed to update registered entity address: ${error.message || 'Unknown error'}`)
    },
  })

  const updateRegisteredEntityCompanyNumberMutation = useMutation({
    mutationFn: (number: string) => settingsApi.update('registered_entity_company_number', number),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['setting', 'registered_entity_company_number'] })
      toast.success('Company number updated successfully!')
    },
    onError: (error: any) => {
      toast.error(`Failed to update company number: ${error.message || 'Unknown error'}`)
    },
  })

  const updateRegisteredEntityTaxNumberMutation = useMutation({
    mutationFn: (number: string) => settingsApi.update('registered_entity_tax_number', number),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['setting', 'registered_entity_tax_number'] })
      toast.success('Tax number updated successfully!')
    },
    onError: (error: any) => {
      toast.error(`Failed to update tax number: ${error.message || 'Unknown error'}`)
    },
  })

const handleEmailFromSubmit = (e: React.FormEvent) => {
    e.preventDefault()
    const trimmed = emailFrom.trim()
    if (!trimmed) {
      toast.error('Email From cannot be empty')
      return
    }
    if (!/^[^<]*<[^\s@]+@[^\s@]+\.[^\s@]+>$/.test(trimmed)) {
      toast.error('Use format: Display Name <email@domain.com>')
      return
    }
    updateEmailFromMutation.mutate(trimmed)
  }

  const handleLegalEmailSubmit = (e: React.FormEvent) => {
    e.preventDefault()
    const trimmed = legalEmailInput.trim()
    if (!trimmed) {
      toast.error('Legal email cannot be empty')
      return
    }
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(trimmed)) {
      toast.error('Enter a valid email address')
      return
    }
    updateLegalEmailMutation.mutate(trimmed)
  }

  const handleAdminEmailSubmit = (e: React.FormEvent) => {
    e.preventDefault()
    if (!adminEmail.trim()) {
      toast.error('Admin email cannot be empty')
      return
    }

    // Validate all emails (semicolon-separated)
    const emails = adminEmail.split(';').map(e => e.trim()).filter(e => e)
    const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/
    const invalidEmails = emails.filter(e => !emailRegex.test(e))
    
    if (invalidEmails.length > 0) {
      toast.error(`Invalid email addresses: ${invalidEmails.join(', ')}`)
      return
    }
    
    // Store as semicolon-separated string
    updateAdminEmailMutation.mutate(emails.join(';'))
  }

  const handleBrandNameSubmit = (e: React.FormEvent) => {
    e.preventDefault()
    const trimmed = brandNameInput.trim()
    if (!trimmed) {
      toast.error('Brand name cannot be empty')
      return
    }
    updateBrandNameMutation.mutate(trimmed)
  }

  const handleSocialXUrlSubmit = (e: React.FormEvent) => {
    e.preventDefault()
    updateSocialXUrlMutation.mutate(socialXUrlInput.trim())
  }
  const handleSocialInstagramUrlSubmit = (e: React.FormEvent) => {
    e.preventDefault()
    updateSocialInstagramUrlMutation.mutate(socialInstagramUrlInput.trim())
  }
  const handleSocialTiktokUrlSubmit = (e: React.FormEvent) => {
    e.preventDefault()
    updateSocialTiktokUrlMutation.mutate(socialTiktokUrlInput.trim())
  }

  // Helper function to parse location string into components
  // Location string format: "venueName, addressLine1, addressLine2, townCity, postcode"
  // All parts are always included (even if empty) to preserve structure
  const parseLocation = (location: string | null) => {
    if (!location) return { venueName: '', addressLine1: '', addressLine2: '', townCity: '', postcode: '' }
    
    // Split by comma and trim - preserve empty strings to maintain structure
    const parts = location.split(',').map(p => p.trim())
    
    // Handle cases where we have exactly 5 parts (new format)
    if (parts.length === 5) {
      return {
        venueName: parts[0] || '',
        addressLine1: parts[1] || '',
        addressLine2: parts[2] || '', // Keep empty if empty in DB
        townCity: parts[3] || '',
        postcode: parts[4] || '',
      }
    }
    
    // Handle legacy formats with fewer parts
    // Old format might be: "venueName, addressLine1, townCity, postcode" (4 parts)
    // Or: "venueName, addressLine1, addressLine2, townCity, postcode" but addressLine2 was empty
    if (parts.length === 4) {
      // Assume old format: venueName, addressLine1, townCity, postcode (no addressLine2)
      return {
        venueName: parts[0] || '',
        addressLine1: parts[1] || '',
        addressLine2: '', // Explicitly empty for old format
        townCity: parts[2] || '',
        postcode: parts[3] || '',
      }
    }
    
    // Fallback: try to map what we have
    return {
      venueName: parts[0] || '',
      addressLine1: parts[1] || '',
      addressLine2: parts.length > 2 && parts[2] ? parts[2] : '', // Only use if it exists and is not empty
      townCity: parts.length > 3 ? parts[3] : parts[2] || '', // Use parts[2] if only 3 parts
      postcode: parts.length > 4 ? parts[4] : parts[3] || parts[2] || '', // Use last part if available
    }
  }

  // Populate form with event data for editing (standalone /admin/events/edit route or legacy)
  const populateFormFromEvent = (event: Event) => {
    const locationParts = parseLocation(event.location)
    const locationTrimmed = (event.location ?? '').trim()
    const hasAnyVenueData =
      !!locationTrimmed ||
      !!(
        locationParts.venueName?.trim() ||
        locationParts.addressLine1?.trim() ||
        locationParts.addressLine2?.trim() ||
        locationParts.townCity?.trim() ||
        locationParts.postcode?.trim()
      )
    // If "Show venue" was off but we still have a stored address, show the block so admins can edit it.
    const showVenueForEdit =
      event.show_venue === false ? hasAnyVenueData : (event.show_venue ?? true)
    setEditingEvent(event)
    setSelectedEvent(null) // Clear selected event when editing
    setFormData({
      name: event.name,
      city: event.city,
      country: event.country || 'United Kingdom',
      currency: event.currency || 'GBP',
      show_venue: showVenueForEdit,
      venueName: locationParts.venueName,
      addressLine1: locationParts.addressLine1,
      addressLine2: locationParts.addressLine2, // Will be empty if it was empty in DB
      townCity: locationParts.townCity,
      postcode: locationParts.postcode,
      event_date: event.event_date ? formatEventDateTimeForInput(event.event_date) : '',
      details: event.details || '',
      event_summary: event.event_summary || '',
      event_what_to_bring: event.event_what_to_bring ?? '- Comfortable clothing\n- Yoga Mat\n- Drinks Bottle',
      event_refund: event.event_refund ?? 'You can receive a refund if you cancel 28 days or more before the event.',
      event_timeline_label: event.event_timeline_label?.trim() || 'The night',
      event_timeline_text: timelineToTextarea(parseEventTimeline(event.event_timeline)),
      event_duration: event.event_duration || 1,
      min_target: event.min_target,
      max_tickets: event.max_tickets != null ? String(event.max_tickets) : '',
      price_pounds: event.price_pence / 100,
      points_awarded: event.points_awarded || 10,
      status: event.status,
      admin_email: event.admin_email,
      latitude: event.latitude?.toString() || '',
      longitude: event.longitude?.toString() || '',
      event_type: (event.event_type as 'physical' | 'hybrid') || 'physical',
      hybrid_link: event.hybrid_link || '',
      hybrid_details: event.hybrid_details || '',
      hybrid_price_pounds: event.hybrid_price_pence != null ? (event.hybrid_price_pence / 100).toFixed(2) : '',
      is_hidden: event.is_hidden ?? false,
      is_featured: event.is_featured ?? false,
      personalise_ticket: event.personalise_ticket ?? false,
      wallet_hero_image_url: event.wallet_hero_image_url ?? '',
      wallet_strip_1x_url: event.wallet_strip_1x_url ?? '',
      wallet_strip_2x_url: event.wallet_strip_2x_url ?? '',
      wallet_strip_3x_url: event.wallet_strip_3x_url ?? '',
      fulfilment_allowed: event.fulfilment_allowed !== false,
      event_program: event.event_program ?? 'yauga_haus',
      host_id: event.host_id ?? '',
    })
    setWalletHeroFile(null)
    setWalletStrip1xFile(null)
    setWalletStrip2xFile(null)
    setWalletStrip3xFile(null)

    // Revoke preview URLs for any previously added (unsaved) images.
    eventImageDrafts.forEach((d) => {
      if (d.kind === 'new') URL.revokeObjectURL(d.preview_url)
    })
    setEventImagesLoading(true)
    setDeletedEventImageDrafts([])
    setEventImageDrafts([])
    eventImagesApi
      .listByEvent(event.id)
      .then((images) => {
        setEventImageDrafts(
          images.map((img) => ({
            kind: 'existing',
            id: img.id,
            storage_path: img.storage_path,
            image_url: img.image_url,
            alt_text: img.alt_text,
            display_order: img.display_order,
            library_image_id: img.library_image_id ?? null,
            orientation: img.orientation === 'portrait' ? 'portrait' : 'landscape',
          }))
        )
      })
      .catch((e) => {
        console.error('Failed to load event images:', e)
        toast.error('Failed to load event images')
      })
      .finally(() => setEventImagesLoading(false))
  }

  const goEventsListView = (key: 'active' | 'completed' | 'featured') => {
    setEventsListView(key)
    setEventsPage(1)
    setSelectedEvent(null)
    setEditingEvent(null)
    setViewMode('class-list')
  }

  useEffect(() => {
    if (!selectedEvent) return
    // Wait for the panel to mount below the events table, then bring it into view.
    const id = window.requestAnimationFrame(() => {
      selectedEventPanelRef.current?.scrollIntoView({ behavior: 'smooth', block: 'start' })
    })
    return () => window.cancelAnimationFrame(id)
  }, [selectedEvent?.id])

  const leaveAdminToEventEditor = (to: string) => {
    // Admin is too large to remount via SPA navigation; hard navigation is reliable.
    window.location.assign(to)
  }

  const handleCancelEdit = () => {
    // Revoke preview URLs for newly added images.
    eventImageDrafts.forEach((d) => {
      if (d.kind === 'new') URL.revokeObjectURL(d.preview_url)
    })
    setEventImageDrafts([])
    setDeletedEventImageDrafts([])
    setEventImagesLoading(false)
    setEventImagesUploading(false)

    setEditingEvent(null)
    setSelectedEvent(null)
    setFormData({
      name: '',
      city: '',
      country: 'United Kingdom',
      currency: 'GBP',
      show_venue: true,
      venueName: '',
      addressLine1: '',
      addressLine2: '',
      townCity: '',
      postcode: '',
      event_date: '',
      details: '',
      event_summary: '',
      event_what_to_bring: '- Comfortable clothing\n- Yoga Mat\n- Drinks Bottle',
      event_refund: 'You can receive a refund if you cancel 28 days or more before the event.',
      event_timeline_label: 'The night',
      event_timeline_text: '',
      event_duration: 2,
      min_target: 10,
      max_tickets: '',
      price_pounds: 25.0,
      points_awarded: 10,
      status: 'collecting_interest',
      admin_email: userEmail || '',
      latitude: '',
      longitude: '',
      event_type: 'physical',
      hybrid_link: '',
      hybrid_details: '',
      hybrid_price_pounds: '',
      is_hidden: false,
      personalise_ticket: false,
      wallet_hero_image_url: '',
      wallet_strip_1x_url: '',
      wallet_strip_2x_url: '',
      wallet_strip_3x_url: '',
      fulfilment_allowed: true,
      is_featured: false,
      event_program: 'yauga_haus',
      host_id: '',
    })
    setWalletHeroFile(null)
    setWalletStrip1xFile(null)
    setWalletStrip2xFile(null)
    setWalletStrip3xFile(null)
    setErrors({})
  }

  const leaveEventEditorToAdmin = () => {
    // Same as leaveAdminToEventEditor: SPA navigate back to /admin does not remount reliably.
    handleCancelEdit()
    window.location.assign('/admin')
  }

  useEffect(() => {
    if (eventEditor !== 'create') return
    handleCancelEdit()
    setEditingEvent(null)
    // eslint-disable-next-line react-hooks/exhaustive-deps -- init blank form once per create route
  }, [eventEditor])

  useEffect(() => {
    if (eventEditor !== 'edit' || !editorRouteEvent) return
    populateFormFromEvent(editorRouteEvent)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [eventEditor, editorRouteEvent])

  const handleCarouselEdit = (item: CarouselItem) => {
    setEditingCarouselItem(item)
    setCarouselFormData({
      image_url: item.image_url,
      headline: item.headline,
      description: item.description,
      title: item.title,
      article: item.article,
      seo_title: item.seo_title || '',
      seo_description: item.seo_description || '',
      seo_keywords: item.seo_keywords || '',
      seo_slug: item.seo_slug || '',
      cta1_label: item.cta1_label ?? '',
      cta1_url: item.cta1_url ?? '',
      cta2_label: item.cta2_label ?? '',
      cta2_url: item.cta2_url ?? '',
      placement:
        item.placement === 'join_us' ||
        item.placement === 'ritual_room' ||
        item.placement === 'run_club' ||
        item.placement === 'yauga_haus'
          ? item.placement
          : 'homepage',
      orientation: item.orientation === 'portrait' ? 'portrait' : 'landscape',
      display_order: item.display_order,
      is_active: item.is_active,
    })
    setShowCarouselForm(true)
    setActiveTab('legal')
    setContentManagementTab('carousel')
  }

  const handleCarouselCancel = () => {
    setEditingCarouselItem(null)
    setShowCarouselForm(false)
    setCarouselImageFile(null)
    setCarouselImagePreview('')
    setCarouselFormData({
      image_url: '',
      headline: '',
      description: '',
      title: '',
      article: '',
      seo_title: '',
      seo_description: '',
      seo_keywords: '',
      seo_slug: '',
      cta1_label: '',
      cta1_url: '',
      cta2_label: '',
      cta2_url: '',
      placement: 'homepage' as CarouselPlacement,
      orientation: 'landscape' as CarouselOrientation,
      display_order: 0,
      is_active: true,
    })
  }

  const handleFAQEdit = (faq: FAQ) => {
    setEditingFAQ(faq)
    setFAQFormData({
      question: faq.question,
      answer: faq.answer,
      display_order: faq.display_order,
      is_active: faq.is_active,
    })
    setShowFAQForm(true)
  }

  const handleFAQSubmit = (e: React.FormEvent) => {
    e.preventDefault()
    if (editingFAQ) {
      updateFAQMutation.mutate({
        id: editingFAQ.id,
        updates: faqFormData,
      })
    } else {
      createFAQMutation.mutate(faqFormData)
    }
  }

  const handleFAQCancel = () => {
    setEditingFAQ(null)
    setShowFAQForm(false)
    setFAQFormData({
      question: '',
      answer: '',
      display_order: 0,
      is_active: true,
    })
  }

  const uploadCarouselMedia = async (file: File): Promise<string> => {
    setUploadingImage(true)
    try {
      const fileExt = file.name.split('.').pop()
      const fileName = `carousel/${Date.now()}-${Math.random().toString(36).substring(7)}.${fileExt}`
      
      const { data, error } = await supabase.storage
        .from('yauga')
        .upload(fileName, file, {
          cacheControl: '3600',
          upsert: false
        })

      if (error) throw error

      const { data: { publicUrl } } = supabase.storage
        .from('yauga')
        .getPublicUrl(data.path)

      setUploadingImage(false)
      return publicUrl
    } catch (error: any) {
      setUploadingImage(false)
      throw new Error(`Failed to upload media: ${error.message}`)
    }
  }

  const uploadLegalPageImage = useCallback(async (file: File): Promise<string> => {
    setUploadingAboutImage(true)
    try {
      const fileExt = file.name.split('.').pop() || 'png'
      const fileName = `legal-pages/${Date.now()}-${Math.random().toString(36).substring(2, 9)}.${fileExt}`
      const { data, error } = await supabase.storage.from('yauga').upload(fileName, file, {
        cacheControl: '3600',
        upsert: false,
      })
      if (error) throw error
      const {
        data: { publicUrl },
      } = supabase.storage.from('yauga').getPublicUrl(data.path)
      return publicUrl
    } finally {
      setUploadingAboutImage(false)
    }
  }, [])

  const confirmAboutImageLayout = useCallback(() => {
    if (!aboutImageLayoutOpen) return
    if (!aboutImageLayoutOpen.alt.trim()) {
      toast.error('Add a short description (alt text) for accessibility.')
      return
    }
    const quill = legalQuillRef.current?.getEditor()
    if (!quill) {
      toast.error('Editor is not ready.')
      return
    }
    const idx = aboutImageInsertIndexRef.current
    const style = buildAboutImageStyle({
      width: aboutImageLayoutOpen.width,
      align: aboutImageLayoutOpen.align,
      tight: aboutImageLayoutOpen.tight,
      wrap: aboutImageLayoutOpen.wrap,
    })
    quill.insertEmbed(idx, 'image', {
      src: aboutImageLayoutOpen.url,
      alt: aboutImageLayoutOpen.alt.trim(),
      style,
    })
    quill.setSelection(idx + 1, 0)
    setAboutImageLayoutOpen(null)
    toast.success('Image inserted')
  }, [aboutImageLayoutOpen])

  useEffect(() => {
    if (!aboutImageLayoutOpen) return
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setAboutImageLayoutOpen(null)
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [aboutImageLayoutOpen])

  const legalQuillModules = useMemo(() => {
    const baseToolbar = [
      [{ header: [1, 2, 3, false] }],
      ['bold', 'italic', 'underline', 'strike'],
      [{ list: 'ordered' }, { list: 'bullet' }],
      [{ color: [] }, { background: [] }],
      ['link', 'table'],
      ['clean'],
    ]
    if (legalPageType !== 'about') {
      return { toolbar: baseToolbar }
    }
    return {
      toolbar: {
        container: [
          [{ header: [1, 2, 3, false] }],
          ['bold', 'italic', 'underline', 'strike'],
          [{ list: 'ordered' }, { list: 'bullet' }],
          [{ color: [] }, { background: [] }],
          [{ align: [] }],
          ['link', 'image', 'table'],
          ['clean'],
        ],
        handlers: {
          image() {
            // eslint-disable-next-line @typescript-eslint/no-explicit-any
            const quill = (this as any).quill
            const sel = quill.getSelection(true)
            aboutImageInsertIndexRef.current = sel?.index ?? Math.max(0, quill.getLength() - 1)
            const input = document.createElement('input')
            input.type = 'file'
            input.accept = 'image/*'
            input.onchange = async () => {
              const file = input.files?.[0]
              if (!file) return
              try {
                const url = await uploadLegalPageImage(file)
                const baseName = file.name.replace(/\.[^.]+$/, '').replace(/[-_]+/g, ' ')
                setAboutImageLayoutOpen({
                  url,
                  alt: baseName,
                  width: 'full',
                  align: 'left',
                  tight: false,
                  wrap: 'block',
                })
              } catch (e: any) {
                toast.error(e?.message || 'Image upload failed')
              }
            }
            input.click()
          },
        },
      },
    }
  }, [legalPageType, uploadLegalPageImage])

  const uploadWalletEventImage = async (file: File, pathKey: string, folderPrefix: string): Promise<string> => {
    const fileExt = file.name.split('.').pop() || 'png'
    const fileName = `${folderPrefix}/${pathKey}.${fileExt}`
    const { data, error } = await supabase.storage
      .from('yauga')
      .upload(fileName, file, { cacheControl: '3600', upsert: false })
    if (error) throw error
    const { data: { publicUrl } } = supabase.storage.from('yauga').getPublicUrl(data.path)
    return publicUrl
  }

  const handleImageFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0]
    if (file) {
      setCarouselImageFile(file)
      const reader = new FileReader()
      reader.onloadend = () => {
        setCarouselImagePreview(reader.result as string)
      }
      reader.readAsDataURL(file)
    }
  }

  // Helper to check if file is a video
  const isVideoFile = (file: File): boolean => {
    return file.type.startsWith('video/') || /\.(mp4|webm|ogg|mov|avi|mkv)$/i.test(file.name)
  }

  const isVideoUrl = (url: string): boolean => {
    return /\.(mp4|webm|ogg|mov)(\?|#|$)/i.test(url)
  }

  const downloadBulkUploadTemplateCsv = () => {
    const headers = [
      'name',
      'city',
      'country',
      'currency',
      'show_venue',
      'venueName',
      'addressLine1',
      'addressLine2',
      'townCity',
      'postcode',
      'event_date',
      'event_duration',
      'min_target',
      'max_tickets',
      'price_pounds',
      'points_awarded',
      'status',
      'details',
      'event_what_to_bring',
      'event_refund',
      'event_type',
      'event_program',
      'hybrid_link',
      'hybrid_details',
      'hybrid_price_pounds',
      'latitude',
      'longitude',
    ]

    const exampleRow = [
      'Yin Yoga & Sound Bath',
      'London',
      'United Kingdom',
      'GBP',
      'true',
      'The Yoga Studio',
      '123 High Street',
      '',
      'London',
      'SW1A 1AA',
      '2026-02-15T18:30',
      '2',
      '10',
      '',
      '25',
      '10',
      'collecting_interest',
      '',
      '- Comfortable clothing\n- Yoga Mat\n- Drinks Bottle',
      'You can receive a refund if you cancel 28 days or more before the event.',
      'physical',
      'yauga_haus',
      '',
      '',
      '',
      '',
      '',
    ]

    const escape = (v: string) => {
      const s = `${v ?? ''}`
      return /[",\n\r]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s
    }

    const csv = `${headers.join(',')}\n${exampleRow.map(escape).join(',')}\n`
    const blob = new Blob([csv], { type: 'text/csv;charset=utf-8' })
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url
    a.download = 'yauga-events-bulk-upload-template.csv'
    document.body.appendChild(a)
    a.click()
    a.remove()
    URL.revokeObjectURL(url)
  }

  const parseCsvRows = (csvText: string): Array<Record<string, string>> => {
    const text = csvText.replace(/\r\n/g, '\n').replace(/\r/g, '\n')
    const rows: string[][] = []
    let row: string[] = []
    let field = ''
    let inQuotes = false

    const pushField = () => {
      row.push(field)
      field = ''
    }
    const pushRow = () => {
      // skip completely empty lines
      if (row.length === 1 && row[0].trim() === '') {
        row = []
        return
      }
      rows.push(row)
      row = []
    }

    for (let i = 0; i < text.length; i++) {
      const ch = text[i]
      const next = i + 1 < text.length ? text[i + 1] : ''

      if (inQuotes) {
        if (ch === '"' && next === '"') {
          field += '"'
          i++
          continue
        }
        if (ch === '"') {
          inQuotes = false
          continue
        }
        field += ch
        continue
      }

      if (ch === '"') {
        inQuotes = true
        continue
      }
      if (ch === ',') {
        pushField()
        continue
      }
      if (ch === '\n') {
        pushField()
        pushRow()
        continue
      }
      field += ch
    }
    // flush
    pushField()
    if (row.length > 0) pushRow()

    if (rows.length < 2) return []
    const headers = rows[0].map(h => h.trim())
    if (headers[0]) headers[0] = headers[0].replace(/^\uFEFF/, '')

    return rows
      .slice(1)
      .filter(r => r.some(v => `${v}`.trim().length > 0))
      .map((r) => {
        const obj: Record<string, string> = {}
        headers.forEach((h, idx) => {
          obj[h] = (r[idx] ?? '').trim()
        })
        return obj
      })
  }

  const parseBool = (v: string, defaultValue: boolean) => {
    const s = (v || '').trim().toLowerCase()
    if (s === '') return defaultValue
    if (['true', '1', 'yes', 'y'].includes(s)) return true
    if (['false', '0', 'no', 'n'].includes(s)) return false
    return defaultValue
  }

  const parseNumberOrNull = (v: string): number | null => {
    const s = (v || '').trim()
    if (!s) return null
    const n = Number(s)
    return Number.isFinite(n) ? n : null
  }

  const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms))

  const geocodeQuery = async (query: string): Promise<{ lat: number; lng: number } | null> => {
    return geocodeLocation(query, legalEmail)
  }

  const handleBulkUploadEvents = async () => {
    if (!userEmail) {
      toast.error('Not authenticated')
      return
    }
    if (!bulkUploadFile) {
      toast.error('Please choose a CSV file to upload')
      return
    }

    setBulkUploadIsProcessing(true)
    setBulkUploadResults([])
    setBulkUploadProgress(null)

    try {
      const csvText = await bulkUploadFile.text()
      const rows = parseCsvRows(csvText)
      if (rows.length === 0) {
        toast.error('No rows found. Please use the template and ensure you saved as CSV.')
        setBulkUploadIsProcessing(false)
        return
      }

      setBulkUploadProgress({ current: 0, total: rows.length })

      const results: Array<{ row: number; status: 'success' | 'error' | 'skipped'; message: string; eventName?: string }> = []
      const geocodeCache = new Map<string, { lat: number; lng: number } | null>()

      for (let idx = 0; idx < rows.length; idx++) {
        const rowNumber = idx + 2 // 1-based, + header row
        const r = rows[idx]
        const eventName = r.name || ''
        setBulkUploadProgress({ current: idx + 1, total: rows.length })

        try {
          // Normalize input (match manual Create/Edit formatting)
          const normalizedName = toTitleCase(r.name || '')
          const normalizedCity = toTitleCase(r.city || '')
          const normalizedVenueName = toTitleCase(r.venueName || '')
          const normalizedAddressLine1 = toTitleCase(r.addressLine1 || '')
          const normalizedAddressLine2 = toTitleCase(r.addressLine2 || '')
          const normalizedTownCity = toTitleCase(r.townCity || '')
          const normalizedPostcode = normalizePostcode(r.postcode || '')

          const currency = (r.currency || 'GBP').trim().toUpperCase()
          const status = (r.status || 'collecting_interest').trim() as Event['status']

          // If ALL venue fields are blank, set show_venue to false
          const allVenueFieldsBlank = [normalizedVenueName, normalizedAddressLine1, normalizedAddressLine2, normalizedTownCity, normalizedPostcode]
            .every(p => !(String(p || '').trim()))
          const showVenue = allVenueFieldsBlank ? false : parseBool(r.show_venue, true)

          const locationParts = [
            normalizedVenueName,
            normalizedAddressLine1,
            normalizedAddressLine2,
            normalizedTownCity,
            normalizedPostcode,
          ].filter(part => part && part.trim().length > 0)
          const location: string | null = showVenue && locationParts.length > 0 ? locationParts.join(', ') : null

          if (showVenue) {
            const missingVenueFields: string[] = []
            if (!normalizedAddressLine1) missingVenueFields.push('addressLine1')
            if (!normalizedTownCity) missingVenueFields.push('townCity')
            if (!normalizedPostcode) missingVenueFields.push('postcode')
            if (missingVenueFields.length > 0) {
              throw new Error(`Missing required venue fields when show_venue=true: ${missingVenueFields.join(', ')}`)
            }
          }

          const pricePounds = parseNumberOrNull(r.price_pounds) ?? 0
          const pointsAwarded = parseNumberOrNull(r.points_awarded) ?? 0
          const minTarget = parseNumberOrNull(r.min_target) ?? 0
          const maxTickets = parseNumberOrNull(r.max_tickets)
          const duration = parseNumberOrNull(r.event_duration)
          const eventTypeRaw = (r.event_type || 'physical').trim().toLowerCase()
          const eventType = eventTypeRaw === 'hybrid' ? 'hybrid' : 'physical'
          const hybridLink = (r.hybrid_link || '').trim() || null
          const hybridDetails = (r.hybrid_details || '').trim() || null
          const hybridPricePounds = parseNumberOrNull(r.hybrid_price_pounds)
          const hybridPricePence = hybridPricePounds != null ? Math.round(hybridPricePounds * 100) : null
          const eventProgram = parseEventProgram(r.event_program)

          let latitude = parseNumberOrNull(r.latitude)
          let longitude = parseNumberOrNull(r.longitude)

          // Geocode if missing (prefer full address if provided)
          if (latitude == null || longitude == null) {
            const addressPartsAny = [
              normalizedVenueName,
              normalizedAddressLine1,
              normalizedAddressLine2,
              normalizedTownCity,
              normalizedPostcode,
            ].filter(part => part && part.trim().length > 0)

            const candidates = Array.from(new Set([
              // Most specific first
              addressPartsAny.length > 0 ? `${addressPartsAny.join(', ')}, ${r.country || ''}` : '',
              (normalizedTownCity && normalizedPostcode) ? `${normalizedTownCity}, ${normalizedPostcode}, ${r.country || ''}` : '',
              normalizedPostcode ? `${normalizedPostcode}, ${r.country || ''}` : '',
              (normalizedTownCity || normalizedCity) ? `${(normalizedTownCity || normalizedCity)}, ${r.country || ''}` : '',
              normalizedCity ? `${normalizedCity}, ${r.country || ''}` : '',
            ].map(s => s.trim()).filter(Boolean)))

            for (const query of candidates) {
              const cacheKey = query.toLowerCase()
              if (!geocodeCache.has(cacheKey)) {
                // throttle to be nice to Nominatim
                await sleep(1100)
                geocodeCache.set(cacheKey, await geocodeQuery(query))
              }
              const coords = geocodeCache.get(cacheKey)
              if (coords) {
                latitude = coords.lat
                longitude = coords.lng
                break
              }
            }

            // Final fallback: existing city-only helper
            if ((latitude == null || longitude == null) && (r.city || r.townCity)) {
              const fallbackKey = `${(r.townCity || r.city)}, ${r.country || ''}`.trim().toLowerCase()
              if (!geocodeCache.has(fallbackKey)) {
                await sleep(1100)
                geocodeCache.set(fallbackKey, await geocodeCity(r.townCity || r.city || '', r.country || '', legalEmail))
              }
              const coords = geocodeCache.get(fallbackKey)
              if (coords) {
                latitude = coords.lat
                longitude = coords.lng
              }
            }
          }

          if (latitude == null || longitude == null) {
            const attemptedCandidates = [
              [normalizedVenueName, normalizedAddressLine1, normalizedAddressLine2, normalizedTownCity, normalizedPostcode].filter(p => p && `${p}`.trim()).join(', '),
              (normalizedTownCity && normalizedPostcode) ? `${normalizedTownCity}, ${normalizedPostcode}` : '',
              normalizedPostcode ? `${normalizedPostcode}` : '',
              (normalizedTownCity || normalizedCity) ? `${(normalizedTownCity || normalizedCity)}` : '',
            ].filter(Boolean)
              .map(s => `${s}, ${r.country || ''}`.trim())
              .join(' | ')
            throw new Error(
              `Unable to geocode latitude/longitude for this row. Tried: "${attemptedCandidates}". ` +
              `Please provide latitude/longitude, or make the location more specific (e.g. add postcode, venue name, or ensure country is set).`
            )
          }

          const details = (r.details || '').trim() || null
          const eventWhatToBring = (r.event_what_to_bring || '').trim() || null
          const eventRefund = (r.event_refund || '').trim() || null

          const validated = eventSchema.parse({
            name: normalizedName,
            city: normalizedCity,
            country: r.country,
            currency,
            show_venue: showVenue,
            location,
            event_date: r.event_date ? parseEventDateTimeLocalForStorage(r.event_date) : null,
            details,
            event_what_to_bring: eventWhatToBring,
            event_refund: eventRefund,
            event_duration: duration ?? null,
            min_target: Number(minTarget),
            max_tickets: maxTickets ?? null,
            price_pence: Math.round(Number(pricePounds) * 100),
            points_awarded: Number(pointsAwarded),
            status,
            admin_email: userEmail,
            latitude: latitude ?? null,
            longitude: longitude ?? null,
            event_type: eventType,
            hybrid_link: hybridLink,
            hybrid_details: hybridDetails,
            hybrid_price_pence: hybridPricePence,
            event_program: eventProgram,
          })

          const eventData: Omit<Event, 'id' | 'created_at' | 'updated_at' | 'registration_count'> = {
            ...validated,
            location: validated.location ?? null,
            event_date: validated.event_date ?? null,
            details: validated.details ?? null,
            event_summary: null,
            event_what_to_bring: validated.event_what_to_bring ?? null,
            event_refund: validated.event_refund ?? null,
            event_timeline_label: null,
            event_timeline: null,
            event_duration: validated.event_duration ?? null,
            latitude: validated.latitude ?? null,
            longitude: validated.longitude ?? null,
            max_tickets: validated.max_tickets ?? null,
            event_type: validated.event_type ?? 'physical',
            hybrid_link: validated.hybrid_link ?? null,
            hybrid_details: validated.hybrid_details ?? null,
            hybrid_price_pence: validated.hybrid_price_pence ?? null,
            event_program: validated.event_program ?? 'yauga_haus',
          }

          await adminApi.createEvent(eventData)
          results.push({ row: rowNumber, status: 'success', message: 'Created', eventName: validated.name })
        } catch (err: any) {
          if (err instanceof z.ZodError) {
            const msg = err.errors.map(e => `${e.path.join('.')}: ${e.message}`).join('; ')
            results.push({ row: rowNumber, status: 'error', message: msg || 'Validation error', eventName })
          } else {
            results.push({ row: rowNumber, status: 'error', message: err?.message || 'Failed to create event', eventName })
          }
        }
      }

      setBulkUploadResults(results)
      queryClient.invalidateQueries({ queryKey: ['admin-events'] })
      queryClient.invalidateQueries({ queryKey: ['admin-events', userEmail] })

      const successCount = results.filter(r => r.status === 'success').length
      const errorCount = results.filter(r => r.status === 'error').length
      toast.success(`Bulk upload complete: ${successCount} created, ${errorCount} failed.`)
    } catch (error: any) {
      toast.error(error?.message || 'Bulk upload failed')
    } finally {
      setBulkUploadIsProcessing(false)
      setBulkUploadProgress(null)
    }
  }

  const handleCarouselSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    const articleText = carouselFormData.article.replace(/<[^>]*>/g, '').replace(/&nbsp;/g, ' ').trim()
    const articleIsBlank = articleText.length === 0
    if (carouselFormData.placement !== 'join_us' && articleIsBlank) {
      toast.error('Article is required for homepage slides')
      return
    }
    setUploadingImage(true)
    
    try {
      let imageUrl = carouselFormData.image_url
      
      // Upload new media if file is selected
      if (carouselImageFile) {
        imageUrl = await uploadCarouselMedia(carouselImageFile)
      }

      const submitData = {
        ...carouselFormData,
        image_url: imageUrl,
        article: articleIsBlank ? '' : carouselFormData.article,
        seo_title: carouselFormData.seo_title.trim() || null,
        seo_description: carouselFormData.seo_description.trim() || null,
        seo_keywords: carouselFormData.seo_keywords.trim() || null,
        seo_slug: carouselFormData.seo_slug.trim() || null,
        cta1_label: carouselFormData.cta1_label.trim() || null,
        cta1_url: carouselFormData.cta1_url.trim() || null,
        cta2_label: carouselFormData.cta2_label.trim() || null,
        cta2_url: carouselFormData.cta2_url.trim() || null,
      }

      if (editingCarouselItem) {
        updateCarouselItemMutation.mutate({ id: editingCarouselItem.id, updates: submitData })
      } else {
        createCarouselItemMutation.mutate(submitData)
      }
    } catch (error: any) {
      toast.error(error.message || 'Failed to upload image')
      setUploadingImage(false)
    }
  }

  const handleFormSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    setErrors({})

    const pricePence = Math.round(Number(formData.price_pounds) * 100)

    const runSave = async () => {
      const normalizeWhitespace = (s: string) => s.replace(/\s+/g, ' ').trim()
      const toTitleCase = (input: string) => {
        const s = normalizeWhitespace(input)
        if (!s) return s
        return s
          .split(' ')
          .map((word) => {
            // Preserve short acronyms (e.g. "UK", "USA")
            if (/^[A-Z]{2,3}$/.test(word)) return word
            return word
              .split('-')
              .map((part) =>
                part
                  .split("'")
                  .map((p) => {
                    const raw = p.trim()
                    if (!raw) return raw
                    // If starts with a digit, keep as-is but normalize trailing letters.
                    if (/^\d/.test(raw)) return raw
                    const lower = raw.toLowerCase()
                    return lower.charAt(0).toUpperCase() + lower.slice(1)
                  })
                  .join("'")
              )
              .join('-')
          })
          .join(' ')
      }

      const normalizedName = toTitleCase(formData.name)
      const normalizedCity = toTitleCase(formData.city)
      const normalizedVenueName = toTitleCase(formData.venueName)
      const normalizedAddressLine1 = toTitleCase(formData.addressLine1)
      const normalizedAddressLine2 = toTitleCase(formData.addressLine2)
      const normalizedTownCity = toTitleCase(formData.townCity)
      const normalizedPostcode = normalizeWhitespace(formData.postcode).toUpperCase()

      // Build location string, filtering out empty parts to avoid ", ," in output
      const locationParts = [
        normalizedVenueName,
        normalizedAddressLine1,
        normalizedAddressLine2,
        normalizedTownCity,
        normalizedPostcode,
      ].filter(part => part && part.trim().length > 0)

      const location: string | null = locationParts.length > 0 ? locationParts.join(', ') : null

      // Validate venue fields if show_venue is enabled
      if (formData.show_venue) {
        const venueErrors: Record<string, string> = {}
        if (!normalizedAddressLine1 || normalizedAddressLine1.trim() === '') {
          venueErrors.addressLine1 = 'Address Line 1 is required when Show Venue Details is enabled'
        }
        // Address Line 2 is optional
        if (!normalizedTownCity || normalizedTownCity.trim() === '') {
          venueErrors.townCity = 'Town/City is required when Show Venue Details is enabled'
        }
        if (!normalizedPostcode || normalizedPostcode.trim() === '') {
          venueErrors.postcode = 'Postcode is required when Show Venue Details is enabled'
        }
        if (Object.keys(venueErrors).length > 0) {
          setErrors(venueErrors)
          toast.error(Object.values(venueErrors).join(' · '), { duration: 6000 })
          return
        }
      }

      try {
        const hybridPricePence = formData.event_type === 'hybrid' && formData.hybrid_price_pounds.trim() !== ''
          ? Math.round(Number(formData.hybrid_price_pounds) * 100)
          : null

        let walletHeroUrl: string | null = null
        let walletStrip1xUrl: string | null = null
        let walletStrip2xUrl: string | null = null
        let walletStrip3xUrl: string | null = null
        if (formData.personalise_ticket) {
          const hasHero = !!formData.wallet_hero_image_url?.trim() || !!walletHeroFile
          const hasStrip1 = !!formData.wallet_strip_1x_url?.trim() || !!walletStrip1xFile
          const hasStrip2 = !!formData.wallet_strip_2x_url?.trim() || !!walletStrip2xFile
          const hasStrip3 = !!formData.wallet_strip_3x_url?.trim() || !!walletStrip3xFile
          if (!hasHero || !hasStrip1 || !hasStrip2 || !hasStrip3) {
            setErrors({
              personalise_ticket: 'Personalised ticket requires all 4 images: Google hero (1032×336), strip 375×98, 750×196, 1125×294.',
            })
            return
          }
          const folderPrefix = `wallet-events/${Date.now()}-${Math.random().toString(36).slice(2, 9)}`
          setUploadingImage(true)
          try {
            walletHeroUrl = walletHeroFile
              ? await uploadWalletEventImage(walletHeroFile, 'hero', folderPrefix)
              : (formData.wallet_hero_image_url?.trim() || null)
            walletStrip1xUrl = walletStrip1xFile
              ? await uploadWalletEventImage(walletStrip1xFile, 'strip1x', folderPrefix)
              : (formData.wallet_strip_1x_url?.trim() || null)
            walletStrip2xUrl = walletStrip2xFile
              ? await uploadWalletEventImage(walletStrip2xFile, 'strip2x', folderPrefix)
              : (formData.wallet_strip_2x_url?.trim() || null)
            walletStrip3xUrl = walletStrip3xFile
              ? await uploadWalletEventImage(walletStrip3xFile, 'strip3x', folderPrefix)
              : (formData.wallet_strip_3x_url?.trim() || null)
          } finally {
            setUploadingImage(false)
          }
        }

        let hostImageUrl: string | null = null
        let hostImageStoragePath: string | null = null
        let hostName: string | null = null
        const selectedHostId = formData.host_id.trim() || null
        if (selectedHostId) {
          const selectedHost = eventHosts.find((h) => h.id === selectedHostId)
          if (!selectedHost) {
            toast.error('Selected host was not found. Pick another or manage hosts first.')
            return
          }
          hostName = selectedHost.name
          hostImageUrl = selectedHost.photo_url
          hostImageStoragePath = selectedHost.photo_storage_path
        }

        if (formData.is_featured) {
          if (eventImageDrafts.length === 0) {
            toast.error('Featured homepage events must include at least one event image.')
            return
          }
        }

        if (eventImageDrafts.length > 0) {
          const hasLandscape = eventImageDrafts.some((d) => d.orientation === 'landscape')
          const hasPortrait = eventImageDrafts.some((d) => d.orientation === 'portrait')
          if (!hasLandscape || !hasPortrait) {
            setErrors((prev) => ({
              ...prev,
              event_images: 'Add at least one landscape and one portrait image.',
            }))
            toast.error('Each event needs both a landscape and a portrait image.')
            return
          }
        }

        const validated = eventSchema.parse({
          name: normalizedName,
          city: normalizedCity,
          country: formData.country,
          currency: formData.currency,
          show_venue: formData.show_venue,
          location: location,
          event_date: parseEventDateTimeLocalForStorage(formData.event_date),
          details: formData.details?.trim() ? formData.details : null,
          event_summary: formData.event_summary?.trim() ? formData.event_summary.trim() : null,
          event_what_to_bring: formData.event_what_to_bring?.trim() || null,
          event_refund: formData.event_refund?.trim() || null,
          event_duration: formData.event_duration || null,
          min_target: Number(formData.min_target),
          max_tickets: formData.max_tickets.trim() !== '' ? Number(formData.max_tickets) : null,
          price_pence: Math.round(Number(formData.price_pounds) * 100),
          points_awarded: Number(formData.points_awarded),
          status: formData.status,
          admin_email: userEmail || formData.admin_email,
          latitude: formData.latitude ? Number(formData.latitude) : (null as number | null),
          longitude: formData.longitude ? Number(formData.longitude) : (null as number | null),
          event_type: formData.event_type,
          hybrid_link: formData.event_type === 'hybrid' && formData.hybrid_link.trim() ? formData.hybrid_link.trim() : null,
          hybrid_details: formData.event_type === 'hybrid' && formData.hybrid_details.trim() ? formData.hybrid_details.trim() : null,
          hybrid_price_pence: hybridPricePence,
          event_program: formData.event_program,
        })

        // Ensure all nullable fields are null instead of undefined to match Event type
        const timelineStops = textareaToTimeline(formData.event_timeline_text || '')
        const eventData: Omit<Event, 'id' | 'created_at' | 'updated_at' | 'registration_count'> = {
          ...validated,
          location: validated.location ?? null,
          event_date: validated.event_date,
          details: validated.details ?? null,
          event_summary: validated.event_summary ?? null,
          event_what_to_bring: validated.event_what_to_bring ?? null,
          event_refund: validated.event_refund ?? null,
          event_timeline_label: formData.event_timeline_label?.trim() || 'The night',
          event_timeline: timelineStops.length > 0 ? timelineStops : null,
          event_duration: validated.event_duration ?? null,
          latitude: validated.latitude ?? null,
          longitude: validated.longitude ?? null,
          event_type: validated.event_type ?? 'physical',
          hybrid_link: validated.hybrid_link ?? null,
          hybrid_details: validated.hybrid_details ?? null,
          hybrid_price_pence: validated.hybrid_price_pence ?? null,
          max_tickets: validated.max_tickets ?? null,
          is_hidden: formData.is_hidden,
          personalise_ticket: formData.personalise_ticket,
          wallet_hero_image_url: walletHeroUrl ?? null,
          wallet_strip_1x_url: walletStrip1xUrl ?? null,
          wallet_strip_2x_url: walletStrip2xUrl ?? null,
          wallet_strip_3x_url: walletStrip3xUrl ?? null,
          fulfilment_allowed: formData.fulfilment_allowed,
          is_featured: formData.is_featured,
          event_program: validated.event_program ?? 'yauga_haus',
          host_id: selectedHostId,
          host_name: hostName,
          host_role: null,
          host_image_url: hostImageUrl,
          host_image_storage_path: hostImageStoragePath,
        }

        if (editingEvent) {
          updateEventMutation.mutate({ id: editingEvent.id, updates: eventData })
        } else {
          createEventMutation.mutate(eventData)
        }
      } catch (error) {
        console.error('Validation error:', error)
        if (error instanceof z.ZodError) {
          const fieldErrors: Record<string, string> = {}
          error.errors.forEach((err) => {
            if (err.path[0]) {
              fieldErrors[err.path[0].toString()] = err.message
            }
          })
          setErrors(fieldErrors)
          const summary = Object.entries(fieldErrors)
            .map(([key, msg]) => {
              const label =
                key === 'event_date'
                  ? 'Event date'
                  : key === 'min_target'
                    ? 'Min target'
                    : key === 'price_pence'
                      ? 'Price'
                      : key === 'points_awarded'
                        ? 'Points awarded'
                        : key === 'admin_email'
                          ? 'Admin email'
                          : key.charAt(0).toUpperCase() + key.slice(1).replace(/_/g, ' ')
              return `${label}: ${msg}`
            })
            .join(' · ')
          toast.error(summary || 'Please fix the highlighted fields below.', { duration: 7000 })
        } else {
          toast.error('Failed to save event: ' + (error as Error).message)
        }
      }
    }

    if (pricePence === 0) {
      setConfirmModal({
        show: true,
        title: 'Is this a free event?',
        message:
          'Tickets will show as FREE on the website. No booking fee is charged and guests book through the normal ticket flow without Stripe payment. Continue?',
        confirmText: 'Yes, free event',
        cancelText: 'Go back',
        onConfirm: () => {
          setConfirmModal(null)
          runSave()
        },
      })
      return
    }

    runSave()
  }

  // Check if user is admin
  const { data: userProfile } = useQuery({
    queryKey: ['user-profile', userEmail],
    queryFn: () => (userEmail ? userProfilesApi.getProfile(userEmail) : null),
    enabled: !!userEmail,
  })

  const isAdmin = userProfile?.is_admin || false

  useEffect(() => {
    if (sessionLoading) return
    if (!session) {
      navigate('/login', { replace: true })
    } else if (userProfile && !isAdmin) {
      // User is logged in but not admin - redirect to home
      toast.error('You do not have permission to access the admin dashboard')
      navigate('/')
    }
  }, [session, sessionLoading, navigate, userProfile, isAdmin])

  if (sessionLoading || !session || (userProfile && !isAdmin)) {
    return null
  }

  const closeMobileMenu = () => setMobileMenuOpen(false)

  const goUsers = () => {
    setActiveTab('users')
    handleCancelEdit()
    handleCarouselCancel()
    handleFAQCancel()
    setLegalPageType(null)
    closeMobileMenu()
  }
  const goLoyalty = () => {
    setActiveTab('loyalty')
    handleCancelEdit()
    handleCarouselCancel()
    handleFAQCancel()
    setLegalPageType(null)
    closeMobileMenu()
  }
  const goRedemptions = () => {
    setActiveTab('redemptions')
    handleCancelEdit()
    handleCarouselCancel()
    handleFAQCancel()
    setLegalPageType(null)
    closeMobileMenu()
  }

  const goReporting = () => {
    setActiveTab('reporting')
    setReportingSubTab('dashboard')
    handleCancelEdit()
    handleCarouselCancel()
    closeMobileMenu()
  }
  const goMonitoring = () => {
    setActiveTab('monitoring')
    handleCancelEdit()
    handleCarouselCancel()
    handleFAQCancel()
    setLegalPageType(null)
    closeMobileMenu()
  }

  const usersSubNavSelectedClass = (selected: boolean) =>
    selected
      ? 'btn-haus-fill rounded-lg px-3 py-1.5 text-sm'
      : 'px-3 py-1.5 rounded-lg text-sm font-medium bg-white/[0.08] text-white/90 hover:bg-white/[0.1]'

  const renderUsersSubNav = () => (
    <nav className="flex flex-wrap gap-2 border-b border-white/[0.12] pb-3" aria-label="Users and loyalty">
      <button type="button" onClick={goUsers} className={usersSubNavSelectedClass(activeTab === 'users')}>
        Users
      </button>
      <button type="button" onClick={goLoyalty} className={usersSubNavSelectedClass(activeTab === 'loyalty')}>
        Loyalty
      </button>
      <button type="button" onClick={goRedemptions} className={usersSubNavSelectedClass(activeTab === 'redemptions')}>
        Redemptions
      </button>
    </nav>
  )

  const adminTabs: AdminNavTab[] = [
    { key: 'events', label: 'Events', onClick: () => { setActiveTab('events'); handleCarouselCancel(); closeMobileMenu(); } },
    { key: 'shop', label: 'Shop', onClick: () => { setActiveTab('shop'); handleCancelEdit(); handleCarouselCancel(); handleFAQCancel(); setLegalPageType(null); closeMobileMenu(); } },
    { key: 'orders', label: 'Orders', onClick: () => { setActiveTab('orders'); handleCancelEdit(); handleCarouselCancel(); handleFAQCancel(); setLegalPageType(null); closeMobileMenu(); } },
    { key: 'discount-codes', label: 'Discount Codes', onClick: () => { setActiveTab('discount-codes'); handleCancelEdit(); handleCarouselCancel(); handleFAQCancel(); setLegalPageType(null); closeMobileMenu(); } },
    { key: 'yauga-token', label: 'Token', onClick: () => { setActiveTab('yauga-token'); handleCancelEdit(); handleCarouselCancel(); handleFAQCancel(); setLegalPageType(null); closeMobileMenu(); } },
    { key: 'legal', label: 'Content Management', onClick: () => { setActiveTab('legal'); setContentManagementTab('legal-pages'); handleCancelEdit(); handleCarouselCancel(); handleFAQCancel(); setLegalPageType(null); closeMobileMenu(); } },
    {
      key: 'users',
      label: 'Users',
      matches: (t) => t === 'users' || t === 'loyalty' || t === 'redemptions',
      onClick: goUsers,
    },
    { key: 'city-leads', label: 'City Leads', onClick: () => { setActiveTab('city-leads'); handleCancelEdit(); handleCarouselCancel(); handleFAQCancel(); setLegalPageType(null); closeMobileMenu(); } },
    {
      key: 'reporting-monitoring',
      label: 'Reporting & Monitoring',
      matches: (t) => t === 'reporting' || t === 'monitoring',
      onClick: goReporting,
    },
    { key: 'settings', label: 'Settings', onClick: () => { setActiveTab('settings'); handleCancelEdit(); handleCarouselCancel(); handleFAQCancel(); setLegalPageType(null); closeMobileMenu(); } },
  ]

  const eventsViewToggleClass = (key: 'active' | 'completed' | 'featured') =>
    `px-4 py-2 text-sm font-medium rounded-lg border transition-colors ${
      eventsListView === key
        ? 'btn-haus-fill'
        : 'btn-haus-ghost text-white/75'
    }`

  const tabButtonClass = (tab: AdminNavTab) =>
    `text-sm py-3 px-3 w-full text-left rounded-lg ${
      adminNavTabSelected(tab) ? 'btn-haus-fill' : 'btn-haus-ghost text-white/75'
    }`


  const renderEventFormCard = () => (
            <div ref={editFormRef} className="bg-[#0B0B0D] rounded-xl shadow-sm p-6 border border-white/[0.12] w-full">
              <h2 className="text-xl font-semibold mb-4">
                {editingEvent ? 'Edit Event' : 'Create New Event'}
              </h2>
              <form
                noValidate
                onSubmit={handleFormSubmit}
                className="space-y-4 max-h-[calc(100vh+150px)] overflow-y-auto"
              >
                <div className="flex items-center">
                  <input
                    type="checkbox"
                    id="is_hidden"
                    checked={formData.is_hidden}
                    onChange={(e) => setFormData({ ...formData, is_hidden: e.target.checked })}
                    className="h-4 w-4 text-primary focus:ring-primary border-white/[0.15] rounded"
                  />
                  <label htmlFor="is_hidden" className="ml-2 block text-sm font-medium text-white/75">
                    Hide event (exclude from homepage and all public filters)
                  </label>
                </div>
                <div className="flex items-start gap-2">
                  <input
                    type="checkbox"
                    id="is_featured"
                    checked={formData.is_featured}
                    onChange={(e) => setFormData({ ...formData, is_featured: e.target.checked })}
                    className="mt-1 h-4 w-4 text-primary focus:ring-primary border-white/[0.15] rounded"
                  />
                  <label htmlFor="is_featured" className="block text-sm font-medium text-white/75">
                    Feature on homepage
                    <span className="block text-xs font-normal text-white/50 mt-0.5">
                      Requires at least one event image below. Only featured events with images appear in the Featured section.
                    </span>
                  </label>
                </div>
                <div className="flex items-center">
                  <input
                    type="checkbox"
                    id="fulfilment_allowed"
                    checked={formData.fulfilment_allowed}
                    onChange={(e) => setFormData({ ...formData, fulfilment_allowed: e.target.checked })}
                    className="h-4 w-4 text-primary focus:ring-primary border-white/[0.15] rounded"
                  />
                  <label htmlFor="fulfilment_allowed" className="ml-2 block text-sm font-medium text-white/75">
                    Allow collect-at-event for ticket add-ons (when unchecked, add-ons ship only)
                  </label>
                </div>
                <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                  <div className="md:col-span-2">
                    <label className="block text-sm font-medium text-white/75 mb-1">Event Name *</label>
                    <input
                      type="text"
                      value={formData.name}
                      onChange={(e) => setFormData({ ...formData, name: e.target.value })}
                      className="w-full px-4 py-2 border border-white/[0.15] rounded-lg focus:ring-2 focus:ring-primary"
                      required
                    />
                    {errors.name && <p className="text-red-500 text-sm mt-1">{errors.name}</p>}
                  </div>
                  
                  <div>
                    <label className="block text-sm font-medium text-white/75 mb-1">City *</label>
                    <input
                      type="text"
                      value={formData.city}
                      onChange={(e) => {
                        const value = e.target.value
                        setFormData({ ...formData, city: value, townCity: value })
                      }}
                      className="w-full px-4 py-2 border border-white/[0.15] rounded-lg focus:ring-2 focus:ring-primary"
                      placeholder="e.g. London"
                      required
                    />
                    {geocoding && <p className="text-xs text-white/50 mt-1">Finding location...</p>}
                    {errors.city && <p className="text-red-500 text-sm mt-1">{errors.city}</p>}
                  </div>

                  <div>
                    <label className="block text-sm font-medium text-white/75 mb-1">Country *</label>
                    <select
                      value={formData.country}
                      onChange={(e) => setFormData({ ...formData, country: e.target.value })}
                      className="w-full px-4 py-2 border border-white/[0.15] rounded-lg focus:ring-2 focus:ring-primary bg-[#0B0B0D] text-white"
                      required
                    >
                      <option value="United Kingdom">United Kingdom</option>
                      <option value="Afghanistan">Afghanistan</option>
                      <option value="Albania">Albania</option>
                      <option value="Algeria">Algeria</option>
                      <option value="Andorra">Andorra</option>
                      <option value="Angola">Angola</option>
                      <option value="Antigua and Barbuda">Antigua and Barbuda</option>
                      <option value="Argentina">Argentina</option>
                      <option value="Armenia">Armenia</option>
                      <option value="Australia">Australia</option>
                      <option value="Austria">Austria</option>
                      <option value="Azerbaijan">Azerbaijan</option>
                      <option value="Bahamas">Bahamas</option>
                      <option value="Bahrain">Bahrain</option>
                      <option value="Bangladesh">Bangladesh</option>
                      <option value="Barbados">Barbados</option>
                      <option value="Belarus">Belarus</option>
                      <option value="Belgium">Belgium</option>
                      <option value="Belize">Belize</option>
                      <option value="Benin">Benin</option>
                      <option value="Bhutan">Bhutan</option>
                      <option value="Bolivia">Bolivia</option>
                      <option value="Bosnia and Herzegovina">Bosnia and Herzegovina</option>
                      <option value="Botswana">Botswana</option>
                      <option value="Brazil">Brazil</option>
                      <option value="Brunei">Brunei</option>
                      <option value="Bulgaria">Bulgaria</option>
                      <option value="Burkina Faso">Burkina Faso</option>
                      <option value="Burundi">Burundi</option>
                      <option value="Cambodia">Cambodia</option>
                      <option value="Cameroon">Cameroon</option>
                      <option value="Canada">Canada</option>
                      <option value="Cape Verde">Cape Verde</option>
                      <option value="Central African Republic">Central African Republic</option>
                      <option value="Chad">Chad</option>
                      <option value="Chile">Chile</option>
                      <option value="China">China</option>
                      <option value="Colombia">Colombia</option>
                      <option value="Comoros">Comoros</option>
                      <option value="Congo">Congo</option>
                      <option value="Costa Rica">Costa Rica</option>
                      <option value="Croatia">Croatia</option>
                      <option value="Cuba">Cuba</option>
                      <option value="Cyprus">Cyprus</option>
                      <option value="Czech Republic">Czech Republic</option>
                      <option value="Denmark">Denmark</option>
                      <option value="Djibouti">Djibouti</option>
                      <option value="Dominica">Dominica</option>
                      <option value="Dominican Republic">Dominican Republic</option>
                      <option value="East Timor">East Timor</option>
                      <option value="Ecuador">Ecuador</option>
                      <option value="Egypt">Egypt</option>
                      <option value="El Salvador">El Salvador</option>
                      <option value="Equatorial Guinea">Equatorial Guinea</option>
                      <option value="Eritrea">Eritrea</option>
                      <option value="Estonia">Estonia</option>
                      <option value="Eswatini">Eswatini</option>
                      <option value="Ethiopia">Ethiopia</option>
                      <option value="Fiji">Fiji</option>
                      <option value="Finland">Finland</option>
                      <option value="France">France</option>
                      <option value="Gabon">Gabon</option>
                      <option value="Gambia">Gambia</option>
                      <option value="Georgia">Georgia</option>
                      <option value="Germany">Germany</option>
                      <option value="Ghana">Ghana</option>
                      <option value="Greece">Greece</option>
                      <option value="Grenada">Grenada</option>
                      <option value="Guatemala">Guatemala</option>
                      <option value="Guinea">Guinea</option>
                      <option value="Guinea-Bissau">Guinea-Bissau</option>
                      <option value="Guyana">Guyana</option>
                      <option value="Haiti">Haiti</option>
                      <option value="Honduras">Honduras</option>
                      <option value="Hungary">Hungary</option>
                      <option value="Iceland">Iceland</option>
                      <option value="India">India</option>
                      <option value="Indonesia">Indonesia</option>
                      <option value="Iran">Iran</option>
                      <option value="Iraq">Iraq</option>
                      <option value="Ireland">Ireland</option>
                      <option value="Israel">Israel</option>
                      <option value="Italy">Italy</option>
                      <option value="Jamaica">Jamaica</option>
                      <option value="Japan">Japan</option>
                      <option value="Jordan">Jordan</option>
                      <option value="Kazakhstan">Kazakhstan</option>
                      <option value="Kenya">Kenya</option>
                      <option value="Kiribati">Kiribati</option>
                      <option value="Kosovo">Kosovo</option>
                      <option value="Kuwait">Kuwait</option>
                      <option value="Kyrgyzstan">Kyrgyzstan</option>
                      <option value="Laos">Laos</option>
                      <option value="Latvia">Latvia</option>
                      <option value="Lebanon">Lebanon</option>
                      <option value="Lesotho">Lesotho</option>
                      <option value="Liberia">Liberia</option>
                      <option value="Libya">Libya</option>
                      <option value="Liechtenstein">Liechtenstein</option>
                      <option value="Lithuania">Lithuania</option>
                      <option value="Luxembourg">Luxembourg</option>
                      <option value="Madagascar">Madagascar</option>
                      <option value="Malawi">Malawi</option>
                      <option value="Malaysia">Malaysia</option>
                      <option value="Maldives">Maldives</option>
                      <option value="Mali">Mali</option>
                      <option value="Malta">Malta</option>
                      <option value="Marshall Islands">Marshall Islands</option>
                      <option value="Mauritania">Mauritania</option>
                      <option value="Mauritius">Mauritius</option>
                      <option value="Mexico">Mexico</option>
                      <option value="Micronesia">Micronesia</option>
                      <option value="Moldova">Moldova</option>
                      <option value="Monaco">Monaco</option>
                      <option value="Mongolia">Mongolia</option>
                      <option value="Montenegro">Montenegro</option>
                      <option value="Morocco">Morocco</option>
                      <option value="Mozambique">Mozambique</option>
                      <option value="Myanmar">Myanmar</option>
                      <option value="Namibia">Namibia</option>
                      <option value="Nauru">Nauru</option>
                      <option value="Nepal">Nepal</option>
                      <option value="Netherlands">Netherlands</option>
                      <option value="New Zealand">New Zealand</option>
                      <option value="Nicaragua">Nicaragua</option>
                      <option value="Niger">Niger</option>
                      <option value="Nigeria">Nigeria</option>
                      <option value="North Korea">North Korea</option>
                      <option value="North Macedonia">North Macedonia</option>
                      <option value="Norway">Norway</option>
                      <option value="Oman">Oman</option>
                      <option value="Pakistan">Pakistan</option>
                      <option value="Palau">Palau</option>
                      <option value="Palestine">Palestine</option>
                      <option value="Panama">Panama</option>
                      <option value="Papua New Guinea">Papua New Guinea</option>
                      <option value="Paraguay">Paraguay</option>
                      <option value="Peru">Peru</option>
                      <option value="Philippines">Philippines</option>
                      <option value="Poland">Poland</option>
                      <option value="Portugal">Portugal</option>
                      <option value="Qatar">Qatar</option>
                      <option value="Romania">Romania</option>
                      <option value="Russia">Russia</option>
                      <option value="Rwanda">Rwanda</option>
                      <option value="Saint Kitts and Nevis">Saint Kitts and Nevis</option>
                      <option value="Saint Lucia">Saint Lucia</option>
                      <option value="Saint Vincent and the Grenadines">Saint Vincent and the Grenadines</option>
                      <option value="Samoa">Samoa</option>
                      <option value="San Marino">San Marino</option>
                      <option value="Sao Tome and Principe">Sao Tome and Principe</option>
                      <option value="Saudi Arabia">Saudi Arabia</option>
                      <option value="Senegal">Senegal</option>
                      <option value="Serbia">Serbia</option>
                      <option value="Seychelles">Seychelles</option>
                      <option value="Sierra Leone">Sierra Leone</option>
                      <option value="Singapore">Singapore</option>
                      <option value="Slovakia">Slovakia</option>
                      <option value="Slovenia">Slovenia</option>
                      <option value="Solomon Islands">Solomon Islands</option>
                      <option value="Somalia">Somalia</option>
                      <option value="South Africa">South Africa</option>
                      <option value="South Korea">South Korea</option>
                      <option value="South Sudan">South Sudan</option>
                      <option value="Spain">Spain</option>
                      <option value="Sri Lanka">Sri Lanka</option>
                      <option value="Sudan">Sudan</option>
                      <option value="Suriname">Suriname</option>
                      <option value="Sweden">Sweden</option>
                      <option value="Switzerland">Switzerland</option>
                      <option value="Syria">Syria</option>
                      <option value="Taiwan">Taiwan</option>
                      <option value="Tajikistan">Tajikistan</option>
                      <option value="Tanzania">Tanzania</option>
                      <option value="Thailand">Thailand</option>
                      <option value="Togo">Togo</option>
                      <option value="Tonga">Tonga</option>
                      <option value="Trinidad and Tobago">Trinidad and Tobago</option>
                      <option value="Tunisia">Tunisia</option>
                      <option value="Turkey">Turkey</option>
                      <option value="Turkmenistan">Turkmenistan</option>
                      <option value="Tuvalu">Tuvalu</option>
                      <option value="Uganda">Uganda</option>
                      <option value="Ukraine">Ukraine</option>
                      <option value="United Arab Emirates">United Arab Emirates</option>
                      <option value="United States">United States</option>
                      <option value="Uruguay">Uruguay</option>
                      <option value="Uzbekistan">Uzbekistan</option>
                      <option value="Vanuatu">Vanuatu</option>
                      <option value="Vatican City">Vatican City</option>
                      <option value="Venezuela">Venezuela</option>
                      <option value="Vietnam">Vietnam</option>
                      <option value="Yemen">Yemen</option>
                      <option value="Zambia">Zambia</option>
                      <option value="Zimbabwe">Zimbabwe</option>
                    </select>
                    {errors.country && <p className="text-red-500 text-sm mt-1">{errors.country}</p>}
                  </div>

                  <div>
                    <label className="block text-sm font-medium text-white/75 mb-1">Event Date</label>
                    <input
                      type="datetime-local"
                      value={formData.event_date}
                      onChange={(e) => setFormData({ ...formData, event_date: e.target.value })}
                      className="w-full px-4 py-2 border border-white/[0.15] rounded-lg focus:ring-2 focus:ring-primary"
                      required
                    />
                    {errors.event_date && <p className="text-red-500 text-sm mt-1">{errors.event_date}</p>}
                  </div>

                  <div>
                    <label className="block text-sm font-medium text-white/75 mb-1">Duration (hours) *</label>
                    <input
                      type="number"
                      step="0.1"
                      min="0.1"
                      value={formData.event_duration}
                      onChange={(e) => setFormData({ ...formData, event_duration: Number(e.target.value) })}
                      className="w-full px-4 py-2 border border-white/[0.15] rounded-lg focus:ring-2 focus:ring-primary"
                      placeholder="1.0"
                      required
                    />
                    {errors.event_duration && <p className="text-red-500 text-sm mt-1">{errors.event_duration}</p>}
                  </div>

                  <div>
                    <label className="block text-sm font-medium text-white/75 mb-1">Timeline heading</label>
                    <select
                      value={formData.event_timeline_label}
                      onChange={(e) => setFormData({ ...formData, event_timeline_label: e.target.value })}
                      className="w-full px-4 py-2 border border-white/[0.15] rounded-lg focus:ring-2 focus:ring-primary bg-[#0B0B0D] text-white"
                    >
                      <option value="The night">The night</option>
                      <option value="The day">The day</option>
                    </select>
                    <p className="text-xs text-white/50 mt-1">Shown above the run-order on /events.</p>
                  </div>

                  <div className="md:col-span-2">
                    <label className="block text-sm font-medium text-white/75 mb-1">
                      Timeline stops (optional)
                    </label>
                    <textarea
                      value={formData.event_timeline_text}
                      onChange={(e) => setFormData({ ...formData, event_timeline_text: e.target.value })}
                      className="w-full px-4 py-2 border border-white/[0.15] rounded-lg focus:ring-2 focus:ring-primary font-mono text-sm"
                      rows={4}
                      placeholder={`19:30 Doors\n20:00 Breathwork\n21:15 Sound\n21:30 Tea`}
                    />
                    <p className="text-xs text-white/50 mt-2">
                      One stop per line as <code className="text-white/70">HH:MM Label</code>. Leave blank to
                      auto-build from start time and duration.
                    </p>
                  </div>

                  <div className="md:col-span-2">
                    <label className="block text-sm font-medium text-white/75 mb-1">
                      Short description (optional)
                    </label>
                    <textarea
                      value={formData.event_summary}
                      onChange={(e) => setFormData({ ...formData, event_summary: e.target.value })}
                      className="w-full px-4 py-2 border border-white/[0.15] rounded-lg focus:ring-2 focus:ring-primary"
                      rows={2}
                      maxLength={320}
                      placeholder="A one–two sentence blurb for the /events listing."
                    />
                    <p className="text-xs text-white/50 mt-2">
                      Shown on /events (Next ritual card). Max 320 characters.
                      {formData.event_summary.trim()
                        ? ` ${formData.event_summary.trim().length}/320`
                        : ''}
                    </p>
                  </div>

                  <div className="md:col-span-2 space-y-3 rounded-lg border border-white/[0.12] bg-[#0B0B0D] p-4">
                    <div className="flex flex-wrap items-center justify-between gap-2">
                      <h3 className="text-sm font-semibold text-white/75">Your host</h3>
                      <button
                        type="button"
                        onClick={() => {
                          window.location.assign('/admin?cm=hosts')
                        }}
                        className="text-xs font-medium text-primary hover:underline"
                      >
                        Manage hosts
                      </button>
                    </div>
                    <div>
                      <label className="block text-sm font-medium text-white/75 mb-1">
                        Attach a host
                      </label>
                      <select
                        value={formData.host_id}
                        onChange={(e) => setFormData({ ...formData, host_id: e.target.value })}
                        className="w-full max-w-md px-4 py-2 border border-white/[0.15] rounded-lg focus:ring-2 focus:ring-primary bg-[#0B0B0D] text-white"
                      >
                        <option value="">No host / to be announced</option>
                        {eventHosts.map((host) => (
                          <option key={host.id} value={host.id}>
                            {host.name}
                          </option>
                        ))}
                      </select>
                      <p className="text-xs text-white/50 mt-2">
                        Hosts are managed under Content Management → Hosts (name + photo). Selecting one
                        avoids re-entering the same person on every event.
                      </p>
                    </div>
                    {formData.host_id
                      ? (() => {
                          const selected = eventHosts.find((h) => h.id === formData.host_id)
                          if (!selected) return null
                          return (
                            <div className="flex items-center gap-3">
                              {selected.photo_url ? (
                                <img
                                  src={selected.photo_url}
                                  alt=""
                                  className="h-14 w-14 rounded-full object-cover border border-white/[0.12]"
                                />
                              ) : (
                                <div className="h-14 w-14 rounded-full border border-white/[0.12] bg-white/[0.06]" />
                              )}
                              <p className="text-sm text-white/80">Hosted by {selected.name}</p>
                            </div>
                          )
                        })()
                      : null}
                  </div>

                  <div className="md:col-span-2">
                    <label className="block text-sm font-medium text-white/75 mb-1">
                      Full description (optional)
                    </label>
                    <textarea
                      value={formData.details}
                      onChange={(e) => setFormData({ ...formData, details: e.target.value })}
                      className="w-full px-4 py-2 border border-white/[0.15] rounded-lg focus:ring-2 focus:ring-primary"
                      rows={4}
                      placeholder={`- Arrive 10 minutes early\n- Bring a mat\n- Session runs 90 mins`}
                    />
                    <p className="text-xs text-white/50 mt-2">
                      Full copy for the event detail page. One item per line; use &quot;- &quot; for bullets.
                    </p>
                  </div>

                  <div className="md:col-span-2">
                    <label className="block text-sm font-medium text-white/75 mb-1">What do I need to bring (optional)</label>
                    <textarea
                      value={formData.event_what_to_bring}
                      onChange={(e) => setFormData({ ...formData, event_what_to_bring: e.target.value })}
                      className="w-full px-4 py-2 border border-white/[0.15] rounded-lg focus:ring-2 focus:ring-primary"
                      rows={4}
                      placeholder={`- Comfortable clothing\n- Yoga Mat\n- Drinks Bottle`}
                    />
                    <p className="text-xs text-white/50 mt-2">One item per line; use &quot;- &quot; for bullets. Shown on the event page.</p>
                  </div>

                  <div className="md:col-span-2">
                    <label className="block text-sm font-medium text-white/75 mb-1">Refund policy (optional)</label>
                    <textarea
                      value={formData.event_refund}
                      onChange={(e) => setFormData({ ...formData, event_refund: e.target.value })}
                      className="w-full px-4 py-2 border border-white/[0.15] rounded-lg focus:ring-2 focus:ring-primary"
                      rows={2}
                      placeholder="You can receive a refund if you cancel 28 days or more before the event."
                    />
                    <p className="text-xs text-white/50 mt-2">Shown in the Refund Policy card on the event page.</p>
                  </div>

                  <div className="md:col-span-2">
                    <label className="block text-sm font-medium text-white/75 mb-1">Program</label>
                    <select
                      value={formData.event_program}
                      onChange={(e) =>
                        setFormData({
                          ...formData,
                          event_program: e.target.value as 'yauga_haus' | 'ritual_room' | 'run_club',
                        })
                      }
                      className="w-full px-4 py-2 border border-white/[0.15] rounded-lg focus:ring-2 focus:ring-primary"
                    >
                      <option value="yauga_haus">Yauga Haus</option>
                      <option value="ritual_room">Ritual Room</option>
                      <option value="run_club">Run Club</option>
                    </select>
                    <p className="text-xs text-white/50 mt-2">Used on the public events list for filtering. Booking flow is unchanged.</p>
                  </div>

                  <div className="md:col-span-2">
                    <label className="block text-sm font-medium text-white/75 mb-1">Event Type</label>
                    <select
                      value={formData.event_type}
                      onChange={(e) => setFormData({ ...formData, event_type: e.target.value as 'physical' | 'hybrid' })}
                      className="w-full px-4 py-2 border border-white/[0.15] rounded-lg focus:ring-2 focus:ring-primary"
                    >
                      <option value="physical">Physical (in-person only)</option>
                      <option value="hybrid">Hybrid (in-person + online ticket option)</option>
                    </select>
                  </div>
                  {formData.event_type === 'hybrid' && (
                    <>
                      <div className="md:col-span-2">
                        <label className="block text-sm font-medium text-white/75 mb-1">Hybrid link (online attendees)</label>
                        <input
                          type="url"
                          value={formData.hybrid_link}
                          onChange={(e) => setFormData({ ...formData, hybrid_link: e.target.value })}
                          className="w-full px-4 py-2 border border-white/[0.15] rounded-lg focus:ring-2 focus:ring-primary"
                          placeholder="https://..."
                        />
                      </div>
                      <div className="md:col-span-2">
                        <label className="block text-sm font-medium text-white/75 mb-1">Hybrid details</label>
                        <textarea
                          value={formData.hybrid_details}
                          onChange={(e) => setFormData({ ...formData, hybrid_details: e.target.value })}
                          className="w-full px-4 py-2 border border-white/[0.15] rounded-lg focus:ring-2 focus:ring-primary"
                          rows={3}
                          placeholder="How to join online, what to expect..."
                        />
                      </div>
                      <div>
                        <label className="block text-sm font-medium text-white/75 mb-1">Hybrid price (£)</label>
                        <input
                          type="number"
                          step="0.01"
                          min="0"
                          value={formData.hybrid_price_pounds}
                          onChange={(e) => setFormData({ ...formData, hybrid_price_pounds: e.target.value })}
                          className="w-full px-4 py-2 border border-white/[0.15] rounded-lg focus:ring-2 focus:ring-primary"
                          placeholder="Same as physical"
                        />
                        <p className="text-xs text-white/50 mt-1">Leave empty to use same price as physical ticket.</p>
                      </div>
                    </>
                  )}

                  <div className="md:col-span-2 border-t pt-4">
                    <div className="flex items-center mb-3">
                      <input
                        type="checkbox"
                        id="show_venue"
                        checked={formData.show_venue}
                        onChange={(e) => setFormData({ ...formData, show_venue: e.target.checked })}
                        className="h-4 w-4 text-primary focus:ring-primary border-white/[0.15] rounded"
                      />
                      <label htmlFor="show_venue" className="ml-2 block text-sm font-medium text-white/75">
                        Show Venue Details
                      </label>
                    </div>
                    {formData.show_venue && (
                      <>
                        <h3 className="text-sm font-semibold text-white/75 mb-3">Venue Address</h3>
                        <div className="space-y-3">
                      <div>
                        <label className="block text-sm font-medium text-white/75 mb-1">Venue Name</label>
                        <input
                          type="text"
                          value={formData.venueName}
                          onChange={(e) => setFormData({ ...formData, venueName: e.target.value })}
                          className="w-full px-4 py-2 border border-white/[0.15] rounded-lg focus:ring-2 focus:ring-primary"
                          placeholder="e.g. The Yoga Studio"
                        />
                      </div>
                      <div>
                        <label className="block text-sm font-medium text-white/75 mb-1">Address Line 1 *</label>
                        <input
                          type="text"
                          value={formData.addressLine1}
                          onChange={(e) => setFormData({ ...formData, addressLine1: e.target.value })}
                          className="w-full px-4 py-2 border border-white/[0.15] rounded-lg focus:ring-2 focus:ring-primary"
                          placeholder="e.g. 123 High Street"
                          required
                        />
                        {errors.addressLine1 && <p className="text-red-500 text-sm mt-1">{errors.addressLine1}</p>}
                      </div>
                      <div>
                        <label className="block text-sm font-medium text-white/75 mb-1">Address Line 2</label>
                        <input
                          type="text"
                          value={formData.addressLine2}
                          onChange={(e) => setFormData({ ...formData, addressLine2: e.target.value })}
                          className="w-full px-4 py-2 border border-white/[0.15] rounded-lg focus:ring-2 focus:ring-primary"
                          placeholder="e.g. Floor 2 (optional)"
                        />
                        {errors.addressLine2 && <p className="text-red-500 text-sm mt-1">{errors.addressLine2}</p>}
                      </div>
                      <div className="grid grid-cols-2 gap-4">
                        <div>
                          <label className="block text-sm font-medium text-white/75 mb-1">Town/City *</label>
                          <input
                            type="text"
                            value={formData.townCity}
                            onChange={(e) => setFormData({ ...formData, townCity: e.target.value })}
                            className="w-full px-4 py-2 border border-white/[0.15] rounded-lg focus:ring-2 focus:ring-primary"
                            placeholder="e.g. London"
                            required
                          />
                          {errors.townCity && <p className="text-red-500 text-sm mt-1">{errors.townCity}</p>}
                        </div>
                        <div>
                          <label className="block text-sm font-medium text-white/75 mb-1">Postcode *</label>
                          <input
                            type="text"
                            value={formData.postcode}
                            onChange={(e) => setFormData({ ...formData, postcode: e.target.value })}
                            className="w-full px-4 py-2 border border-white/[0.15] rounded-lg focus:ring-2 focus:ring-primary"
                            placeholder="e.g. SW1A 1AA"
                            required
                          />
                          {errors.postcode && <p className="text-red-500 text-sm mt-1">{errors.postcode}</p>}
                        </div>
                      </div>
                    </div>
                      </>
                    )}
                  </div>

                  <div className="md:col-span-2 space-y-3">
                    <div className="flex items-center">
                      <input
                        type="checkbox"
                        id="personalise_ticket"
                        checked={formData.personalise_ticket}
                        onChange={(e) => setFormData({ ...formData, personalise_ticket: e.target.checked })}
                        className="h-4 w-4 text-primary focus:ring-primary border-white/[0.15] rounded"
                      />
                      <label htmlFor="personalise_ticket" className="ml-2 block text-sm font-medium text-white/75">
                        Personalise Ticket? (use custom images in Google &amp; Apple Wallet)
                      </label>
                    </div>
                    {formData.personalise_ticket && (
                      <div className="rounded-lg border border-white/[0.12] bg-[#070707] p-4 space-y-3">
                        <p className="text-sm text-white/65">Upload all 4 images. Required sizes:</p>
                        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                          <div>
                            <label className="block text-sm font-medium text-white/75 mb-1">Google Wallet hero (1032×336 px) *</label>
                            <input
                              type="file"
                              accept="image/*"
                              onChange={(e) => setWalletHeroFile(e.target.files?.[0] ?? null)}
                              className="block w-full text-sm text-white/50 file:mr-2 file:rounded file:border file:border-[#8B5CF6]/45 file:bg-[#050505] file:px-3 file:py-1.5 file:text-sm file:font-semibold file:text-white file:shadow-[0_0_14px_rgba(139,92,246,0.28)] file:ring-1 file:ring-inset file:ring-[#8B5CF6]/25 hover:file:border-[#8B5CF6]/60 hover:file:bg-[#121212]"
                            />
                            {formData.wallet_hero_image_url && !walletHeroFile && <p className="text-xs text-green-600 mt-1">Current image set</p>}
                          </div>
                          <div>
                            <label className="block text-sm font-medium text-white/75 mb-1">strip.png (375×98 px) *</label>
                            <input
                              type="file"
                              accept="image/*"
                              onChange={(e) => setWalletStrip1xFile(e.target.files?.[0] ?? null)}
                              className="block w-full text-sm text-white/50 file:mr-2 file:rounded file:border file:border-[#8B5CF6]/45 file:bg-[#050505] file:px-3 file:py-1.5 file:text-sm file:font-semibold file:text-white file:shadow-[0_0_14px_rgba(139,92,246,0.28)] file:ring-1 file:ring-inset file:ring-[#8B5CF6]/25 hover:file:border-[#8B5CF6]/60 hover:file:bg-[#121212]"
                            />
                            {formData.wallet_strip_1x_url && !walletStrip1xFile && <p className="text-xs text-green-600 mt-1">Current image set</p>}
                          </div>
                          <div>
                            <label className="block text-sm font-medium text-white/75 mb-1">strip@2x.png (750×196 px) *</label>
                            <input
                              type="file"
                              accept="image/*"
                              onChange={(e) => setWalletStrip2xFile(e.target.files?.[0] ?? null)}
                              className="block w-full text-sm text-white/50 file:mr-2 file:rounded file:border file:border-[#8B5CF6]/45 file:bg-[#050505] file:px-3 file:py-1.5 file:text-sm file:font-semibold file:text-white file:shadow-[0_0_14px_rgba(139,92,246,0.28)] file:ring-1 file:ring-inset file:ring-[#8B5CF6]/25 hover:file:border-[#8B5CF6]/60 hover:file:bg-[#121212]"
                            />
                            {formData.wallet_strip_2x_url && !walletStrip2xFile && <p className="text-xs text-green-600 mt-1">Current image set</p>}
                          </div>
                          <div>
                            <label className="block text-sm font-medium text-white/75 mb-1">strip@3x.png (1125×294 px) *</label>
                            <input
                              type="file"
                              accept="image/*"
                              onChange={(e) => setWalletStrip3xFile(e.target.files?.[0] ?? null)}
                              className="block w-full text-sm text-white/50 file:mr-2 file:rounded file:border file:border-[#8B5CF6]/45 file:bg-[#050505] file:px-3 file:py-1.5 file:text-sm file:font-semibold file:text-white file:shadow-[0_0_14px_rgba(139,92,246,0.28)] file:ring-1 file:ring-inset file:ring-[#8B5CF6]/25 hover:file:border-[#8B5CF6]/60 hover:file:bg-[#121212]"
                            />
                            {formData.wallet_strip_3x_url && !walletStrip3xFile && <p className="text-xs text-green-600 mt-1">Current image set</p>}
                          </div>
                        </div>
                        {errors.personalise_ticket && <p className="text-red-500 text-sm">{errors.personalise_ticket}</p>}
                      </div>
                    )}
                  </div>

                  {/* Event Images (1..many) with required alt text */}
                  <div className="md:col-span-2 space-y-3">
                    <div className="flex items-center justify-between gap-4">
                      <h3 className="text-sm font-semibold text-white/75">Event Images</h3>
                      {eventImagesUploading && (
                        <p className="text-xs text-white/50" aria-live="polite">
                          Uploading...
                        </p>
                      )}
                    </div>

                    <div className="flex flex-col gap-3 sm:flex-row sm:flex-wrap sm:items-end">
                      <button
                        type="button"
                        onClick={() => setLibraryPickerOpen(true)}
                        className="px-4 py-2 rounded-lg border border-white/[0.15] text-sm font-medium text-white/90 bg-[#070707] hover:bg-[#101012] shrink-0"
                      >
                        Add from library
                      </button>
                      <div className="flex-1 min-w-[220px]">
                        <label className="block text-sm font-medium text-white/75 mb-1">
                          Upload new (added to library & this event) *
                        </label>
                        <input
                          type="file"
                          multiple
                          accept="image/*"
                          onChange={(e) => addEventImageFiles(e.target.files)}
                          className="block w-full text-sm text-white/50 file:mr-2 file:rounded file:border file:border-[#8B5CF6]/45 file:bg-[#050505] file:px-3 file:py-1.5 file:text-sm file:font-semibold file:text-white file:shadow-[0_0_14px_rgba(139,92,246,0.28)] file:ring-1 file:ring-inset file:ring-[#8B5CF6]/25 hover:file:border-[#8B5CF6]/60 hover:file:bg-[#121212]"
                        />
                      </div>
                    </div>
                    <p className="text-xs text-white/50 mt-2">
                      Alt text is required. Mark each image as landscape (detail page left) or portrait
                      (mobile hero). Every event needs at least one of each. New uploads use your City
                      field as the library title when possible — edit titles under Content Management →
                      Image Library.
                    </p>

                    {errors.event_images && <p className="text-red-500 text-sm">{errors.event_images}</p>}

                    {eventImagesLoading ? (
                      <p className="text-sm text-white/65" aria-live="polite">
                        Loading existing images...
                      </p>
                    ) : eventImageDrafts.length === 0 ? (
                      <p className="text-sm text-white/50">No images added yet.</p>
                    ) : (
                      <div className="space-y-3">
                        {eventImageDrafts.map((img, index) => {
                          const src =
                            img.kind === 'existing' || img.kind === 'library_pick'
                              ? img.image_url
                              : img.preview_url
                          const alt = img.alt_text.trim() ? img.alt_text.trim() : `Event image ${index + 1}`
                          const rowKey =
                            img.kind === 'existing'
                              ? img.id
                              : img.kind === 'library_pick'
                                ? `lib-${img.library_image_id}-${index}`
                                : `new-${index}`
                          const fromLibrary =
                            img.kind === 'library_pick' ||
                            (img.kind === 'existing' && !!img.library_image_id)
                          return (
                            <div
                              key={rowKey}
                              className="flex gap-3 items-start rounded-lg border border-white/[0.12] bg-[#0B0B0D] p-3"
                            >
                              <div className="w-24 h-16 rounded-md overflow-hidden bg-white/[0.08] flex-shrink-0">
                                <img
                                  src={src}
                                  alt={alt}
                                  className="w-full h-full object-cover"
                                  draggable={false}
                                />
                              </div>

                              <div className="flex-1 min-w-0">
                                {fromLibrary && (
                                  <p className="text-xs font-medium text-primary mb-1">Image Library</p>
                                )}
                                <label className="block text-sm font-medium text-white/75 mb-1">
                                  Alt text for image {index + 1} *
                                </label>
                                <input
                                  type="text"
                                  value={img.alt_text}
                                  onChange={(e) => updateEventImageAltText(index, e.target.value)}
                                  placeholder="Describe what’s in the image"
                                  className="w-full px-4 py-2 border border-white/[0.15] rounded-lg focus:ring-2 focus:ring-primary"
                                />
                                <label className="block text-sm font-medium text-white/75 mb-1 mt-2">
                                  Orientation *
                                </label>
                                <select
                                  value={img.orientation}
                                  onChange={(e) =>
                                    updateEventImageOrientation(
                                      index,
                                      e.target.value === 'portrait' ? 'portrait' : 'landscape'
                                    )
                                  }
                                  className="w-full max-w-xs px-4 py-2 border border-white/[0.15] rounded-lg focus:ring-2 focus:ring-primary bg-[#0B0B0D] text-white"
                                >
                                  <option value="landscape">Landscape</option>
                                  <option value="portrait">Portrait</option>
                                </select>

                                <div className="flex gap-2 mt-2 flex-wrap">
                                  <button
                                    type="button"
                                    onClick={() => moveEventImageDraft(index, -1)}
                                    disabled={index === 0}
                                    className="px-3 py-1.5 text-xs font-medium rounded-lg border border-white/[0.15] text-white/75 bg-[#0B0B0D] hover:bg-[#070707] disabled:opacity-50 disabled:cursor-not-allowed"
                                    aria-label={`Move image ${index + 1} up`}
                                  >
                                    Up
                                  </button>
                                  <button
                                    type="button"
                                    onClick={() => moveEventImageDraft(index, 1)}
                                    disabled={index === eventImageDrafts.length - 1}
                                    className="px-3 py-1.5 text-xs font-medium rounded-lg border border-white/[0.15] text-white/75 bg-[#0B0B0D] hover:bg-[#070707] disabled:opacity-50 disabled:cursor-not-allowed"
                                    aria-label={`Move image ${index + 1} down`}
                                  >
                                    Down
                                  </button>
                                  <button
                                    type="button"
                                    onClick={() => removeEventImageDraft(index)}
                                    className="px-3 py-1.5 text-xs font-medium rounded-lg bg-red-50 text-red-700 border border-red-200 hover:bg-red-100"
                                    aria-label={`Remove image ${index + 1}`}
                                  >
                                    Remove
                                  </button>
                                </div>
                              </div>
                            </div>
                          )
                        })}
                      </div>
                    )}

                    {libraryPickerOpen && (
                      <div
                        className="fixed inset-0 z-[200] flex items-center justify-center p-4 bg-black/70"
                        role="dialog"
                        aria-modal="true"
                        aria-labelledby="library-picker-title"
                      >
                        <div className="bg-[#0B0B0D] border border-white/[0.12] rounded-xl max-w-3xl w-full max-h-[85vh] overflow-hidden flex flex-col shadow-xl">
                          <div className="flex items-center justify-between gap-3 px-4 py-3 border-b border-white/[0.08]">
                            <h4 id="library-picker-title" className="text-lg font-semibold text-white">
                              Choose from Image Library
                            </h4>
                            <button
                              type="button"
                              className="text-white/70 hover:text-white px-2 py-1 rounded text-sm"
                              onClick={() => setLibraryPickerOpen(false)}
                            >
                              Close
                            </button>
                          </div>
                          <div className="p-4 overflow-y-auto">
                            {locationLibraryList.length === 0 ? (
                              <p className="text-sm text-white/55">
                                No library images yet. Open Content Management → Image Library to upload some, or use
                                &quot;Upload new&quot; above- files are saved to the library automatically.
                              </p>
                            ) : (
                              <div className="grid grid-cols-2 sm:grid-cols-3 gap-3">
                                {locationLibraryList.map((lib) => (
                                  <button
                                    key={lib.id}
                                    type="button"
                                    onClick={() => addLibraryPickFromLibrary(lib)}
                                    className="text-left rounded-lg border border-white/[0.12] overflow-hidden hover:border-primary/60 focus:outline-none focus:ring-2 focus:ring-primary"
                                  >
                                    <div className="aspect-[16/10] bg-black/30">
                                      <img
                                        src={lib.image_url}
                                        alt={lib.alt_text || lib.title}
                                        className="w-full h-full object-cover"
                                      />
                                    </div>
                                    <div className="p-2 bg-[#070707]">
                                      <p className="text-xs font-medium text-white truncate">{lib.title}</p>
                                    </div>
                                  </button>
                                ))}
                              </div>
                            )}
                          </div>
                        </div>
                      </div>
                    )}
                  </div>

                  <div>
                    <label className="block text-sm font-medium text-white/75 mb-1">Min Target *</label>
                    <input
                      type="number"
                      value={formData.min_target}
                      onChange={(e) => setFormData({ ...formData, min_target: Number(e.target.value) })}
                      className="w-full px-4 py-2 border border-white/[0.15] rounded-lg focus:ring-2 focus:ring-primary"
                      min="1"
                      required
                    />
                    {errors.min_target && <p className="text-red-500 text-sm mt-1">{errors.min_target}</p>}
                  </div>

                  <div>
                    <label className="block text-sm font-medium text-white/75 mb-1">Max Tickets</label>
                    <input
                      type="number"
                      value={formData.max_tickets}
                      onChange={(e) => setFormData({ ...formData, max_tickets: e.target.value })}
                      className="w-full px-4 py-2 border border-white/[0.15] rounded-lg focus:ring-2 focus:ring-primary"
                      min="1"
                      placeholder="Leave blank for unlimited"
                    />
                    <p className="text-xs text-white/50 mt-1">Leave blank for unlimited. For hybrid, only physical tickets count toward this.</p>
                  </div>

                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                    <div>
                      <label className="block text-sm font-medium text-white/75 mb-1">Currency *</label>
                      <select
                        value={formData.currency}
                        onChange={(e) => setFormData({ ...formData, currency: e.target.value })}
                        className="w-full px-4 py-2 border border-white/[0.15] rounded-lg focus:ring-2 focus:ring-primary bg-[#0B0B0D] text-white"
                        required
                      >
                        <option value="GBP">GBP (£)</option>
                        <option value="USD">USD ($)</option>
                      </select>
                      {errors.currency && <p className="text-red-500 text-sm mt-1">{errors.currency}</p>}
                    </div>
                    <div>
                      <label className="block text-sm font-medium text-white/75 mb-1">
                        Price ({formData.currency === 'GBP' ? '£' : '$'}) *
                      </label>
                      <div className="relative">
                        <span className="absolute left-3 top-2.5 text-white/50">
                          {formData.currency === 'GBP' ? '£' : '$'}
                        </span>
                        <input
                          type="number"
                          step="0.01"
                          value={formData.price_pounds}
                          onChange={(e) => setFormData({ ...formData, price_pounds: Number(e.target.value) })}
                          className="w-full pl-8 pr-4 py-2 border border-white/[0.15] rounded-lg focus:ring-2 focus:ring-primary"
                          min="0"
                          placeholder="25.00"
                          required
                        />
                      </div>
                      {errors.price_pence && <p className="text-red-500 text-sm mt-1">{errors.price_pence}</p>}
                      <p className="text-xs text-white/50 mt-1">Set to 0 for a free event (shown as FREE; no booking fee at checkout).</p>
                    </div>
                  </div>

                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                    <div>
                      <label className="block text-sm font-medium text-white/75 mb-1">Points Awarded *</label>
                      <input
                        type="number"
                        value={formData.points_awarded}
                        onChange={(e) => setFormData({ ...formData, points_awarded: Number(e.target.value) })}
                        className="w-full px-4 py-2 border border-white/[0.15] rounded-lg focus:ring-2 focus:ring-primary"
                        min="0"
                        required
                      />
                      {errors.points_awarded && <p className="text-red-500 text-sm mt-1">{errors.points_awarded}</p>}
                    </div>
                    <div>
                      <label className="block text-sm font-medium text-white/75 mb-1">Status *</label>
                      <select
                        value={formData.status}
                        onChange={(e) => setFormData({ ...formData, status: e.target.value as any })}
                        className="w-full px-4 py-2 border border-white/[0.15] rounded-lg focus:ring-2 focus:ring-primary"
                      >
                        <option value="draft">Draft</option>
                        <option value="collecting_interest">Collecting Interest</option>
                        <option value="open">Open</option>
                        <option value="closed">Closed</option>
                        <option value="completed">Completed</option>
                        <option value="sold_out">Sold Out</option>
                      </select>
                    </div>
                  </div>

                  <div className="md:col-span-2 border-t pt-4">
                    <h3 className="text-sm font-semibold text-white/75 mb-3">Location Coordinates (Auto-filled from City)</h3>
                    <div className="grid grid-cols-2 gap-4">
                      <div>
                        <label className="block text-sm font-medium text-violet-400 mb-1">Latitude</label>
                        <input
                          type="number"
                          step="any"
                          value={formData.latitude}
                          onChange={(e) => setFormData({ ...formData, latitude: e.target.value })}
                          className="w-full px-4 py-2 border border-violet-500/35 rounded-lg focus:ring-2 focus:ring-violet-500/50 bg-[#070707] text-violet-300 placeholder:text-violet-500/50"
                          placeholder="Auto-filled"
                          readOnly
                        />
                      </div>
                      <div>
                        <label className="block text-sm font-medium text-violet-400 mb-1">Longitude</label>
                        <input
                          type="number"
                          step="any"
                          value={formData.longitude}
                          onChange={(e) => setFormData({ ...formData, longitude: e.target.value })}
                          className="w-full px-4 py-2 border border-violet-500/35 rounded-lg focus:ring-2 focus:ring-violet-500/50 bg-[#070707] text-violet-300 placeholder:text-violet-500/50"
                          placeholder="Auto-filled"
                          readOnly
                        />
                      </div>
                    </div>
                    <p className="text-xs text-violet-400/80 mt-1">Coordinates are automatically fetched when you enter a city</p>
                  </div>
                </div>
                <div className="flex gap-2 pt-4">
                  <button
                    type="submit"
                    disabled={createEventMutation.isPending || updateEventMutation.isPending}
                    className="btn-haus-fill px-6 py-2 rounded-lg disabled:opacity-50"
                  >
                    {createEventMutation.isPending || updateEventMutation.isPending
                      ? (editingEvent ? 'Updating...' : 'Creating...')
                      : (editingEvent ? 'Update Event' : 'Create Event')}
                  </button>
                  <button
                    type="button"
                    onClick={() => {
                      if (eventEditor) {
                        leaveEventEditorToAdmin()
                        return
                      }
                      handleCancelEdit()
                    }}
                    className="btn-haus-outline px-6 py-2 rounded-lg"
                  >
                    Cancel
                  </button>
                </div>
                {(createEventMutation.isError || updateEventMutation.isError) && (
                  <div className="bg-red-50 border border-red-200 rounded-lg p-3 text-red-700 text-sm mt-4">
                    Error: {(createEventMutation.error || updateEventMutation.error)?.message || 'Failed to save event'}
                  </div>
                )}
              </form>
            </div>
  )

  const renderConfirmModal = () =>
    confirmModal && confirmModal.show ? (
      <div
        className="fixed inset-0 z-50 flex items-center justify-center bg-black bg-opacity-50 p-4"
        onMouseDown={(e) => {
          if (e.target === e.currentTarget) setConfirmModal(null)
        }}
      >
        <div
          ref={confirmDialog.dialogRef}
          role="dialog"
          aria-modal="true"
          aria-labelledby="admin-confirm-title"
          aria-describedby="admin-confirm-desc"
          tabIndex={-1}
          onKeyDown={confirmDialog.onKeyDown}
          className="bg-[#0B0B0D] rounded-xl shadow-xl max-w-md w-full focus:outline-none"
        >
          <div className="p-6">
            <h2 id="admin-confirm-title" className="text-2xl font-bold text-white mb-4">{confirmModal.title}</h2>
            <p id="admin-confirm-desc" className="text-white/65 mb-6">{confirmModal.message}</p>
            <div className="flex gap-3">
              <button
                onClick={() => {
                  confirmModal.onConfirm()
                }}
                className={`flex-1 rounded-lg px-6 py-3 font-semibold text-white focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-offset-2 focus-visible:ring-offset-[#0B0B0D] ${confirmModal.confirmButtonClass || 'btn-haus-fill focus-visible:ring-[#A78BFA]'}`}
              >
                {confirmModal.confirmText || 'Confirm'}
              </button>
              <button
                onClick={() => setConfirmModal(null)}
                className="btn-haus-outline flex-1 rounded-lg px-6 py-3 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#A78BFA] focus-visible:ring-offset-2 focus-visible:ring-offset-[#0B0B0D]"
              >
                {confirmModal.cancelText || 'Cancel'}
              </button>
            </div>
          </div>
        </div>
      </div>
    ) : null

  const renderTestBookingDeleteModal = () => {
    if (!testBookingDelete) return null
    const { event, step, email } = testBookingDelete
    const emailReady = email.trim().includes('@')
    return (
      <div
        className="fixed inset-0 z-50 flex items-center justify-center bg-black bg-opacity-50 p-4"
        onMouseDown={(e) => {
          if (e.target === e.currentTarget && !deleteTestEventMutation.isPending) setTestBookingDelete(null)
        }}
      >
        <div
          ref={testBookingDeleteDialog.dialogRef}
          role="dialog"
          aria-modal="true"
          aria-labelledby="admin-test-booking-title"
          tabIndex={-1}
          onKeyDown={testBookingDeleteDialog.onKeyDown}
          className="bg-[#0B0B0D] rounded-xl shadow-xl max-w-md w-full focus:outline-none"
        >
          <div className="p-6">
            <h2 id="admin-test-booking-title" className="text-2xl font-bold text-white mb-4">
              Delete event
            </h2>
            {step === 'ask' ? (
              <>
                <p className="text-white/65 mb-6">
                  {event.name} has tickets assigned. Is this a test booking?
                </p>
                <div className="flex gap-3">
                  <button
                    type="button"
                    onClick={() => setTestBookingDelete({ ...testBookingDelete, step: 'email' })}
                    className="flex-1 rounded-lg bg-red-500 px-6 py-3 font-semibold text-white hover:bg-red-600"
                  >
                    Yes
                  </button>
                  <button
                    type="button"
                    onClick={() => setTestBookingDelete(null)}
                    className="btn-haus-outline flex-1 rounded-lg px-6 py-3"
                  >
                    No
                  </button>
                </div>
              </>
            ) : (
              <form
                onSubmit={(e) => {
                  e.preventDefault()
                  if (!emailReady || deleteTestEventMutation.isPending) return
                  deleteTestEventMutation.mutate({ id: event.id, email: email.trim() })
                }}
              >
                <p className="text-white/65 mb-4">
                  Enter the email address used to buy these tickets. The tickets and this event are deleted only when every ticket belongs to that address.
                </p>
                <label className="block text-sm font-medium text-white/80 mb-2" htmlFor="test-booking-email">
                  Email address
                </label>
                <input
                  id="test-booking-email"
                  type="email"
                  required
                  autoComplete="off"
                  value={email}
                  onChange={(e) => setTestBookingDelete({ ...testBookingDelete, email: e.target.value })}
                  className="mb-6 w-full rounded-lg border border-white/[0.15] bg-[#070707] px-3 py-2 text-white"
                  placeholder="name@example.com"
                />
                <div className="flex gap-3">
                  <button
                    type="submit"
                    disabled={!emailReady || deleteTestEventMutation.isPending}
                    className="flex-1 rounded-lg bg-red-500 px-6 py-3 font-semibold text-white hover:bg-red-600 disabled:opacity-50"
                  >
                    {deleteTestEventMutation.isPending ? 'Deleting…' : 'Delete'}
                  </button>
                  <button
                    type="button"
                    disabled={deleteTestEventMutation.isPending}
                    onClick={() => setTestBookingDelete({ ...testBookingDelete, step: 'ask' })}
                    className="btn-haus-outline flex-1 rounded-lg px-6 py-3"
                  >
                    Back
                  </button>
                </div>
              </form>
            )}
          </div>
        </div>
      </div>
    )
  }

  const renderRegenerateEventModal = () => {
    if (!regenerateEventModal) return null
    const { event, step, includeMessage, message, isSending } = regenerateEventModal
    const bookingsCount = event.bookings_count ?? 0

    const close = () => {
      if (!isSending) setRegenerateEventModal(null)
    }

    const runRegenerate = async () => {
      setRegenerateEventModal((m) => (m ? { ...m, isSending: true } : null))
      try {
        const result = await adminApi.regenerateEventConfirmations(
          event.id,
          includeMessage ? message : undefined
        )
        if ((result.total ?? 0) === 0) {
          toast.error(result.message || 'No confirmed bookings for this event')
        } else if ((result.failed ?? 0) > 0) {
          toast.error(`Sent ${result.sent ?? 0} of ${result.total}. ${result.failed} failed.`)
        } else {
          toast.success(
            `Regenerated confirmations for ${result.sent ?? 0} attendee${result.sent === 1 ? '' : 's'}.`
          )
        }
        setRegenerateEventModal(null)
      } catch (e: unknown) {
        const err = e as { message?: string }
        toast.error(err?.message || 'Failed to regenerate confirmations')
        setRegenerateEventModal((m) => (m ? { ...m, isSending: false } : null))
      }
    }

    return (
      <div
        className="fixed inset-0 z-50 flex items-center justify-center bg-black bg-opacity-50 p-4"
        onMouseDown={(e) => {
          if (e.target === e.currentTarget && !isSending) close()
        }}
      >
        <div
          ref={regenerateEventDialog.dialogRef}
          role="dialog"
          aria-modal="true"
          aria-labelledby="regenerate-event-title"
          tabIndex={-1}
          onKeyDown={regenerateEventDialog.onKeyDown}
          className="bg-[#0B0B0D] rounded-xl shadow-xl max-w-md w-full focus:outline-none"
        >
          <div className="p-6">
            {step === 'message-choice' && (
              <>
                <h2 id="regenerate-event-title" className="text-2xl font-bold text-white mb-2">
                  Regenerate confirmations
                </h2>
                <p className="text-white/65 mb-6">
                  Resend updated confirmation emails for <strong className="text-white">{event.name}</strong>.
                </p>
                <p className="text-white mb-4">Do you wish to include a message?</p>
                <div className="flex gap-3">
                  <button
                    type="button"
                    onClick={() =>
                      setRegenerateEventModal({
                        ...regenerateEventModal,
                        step: 'message-input',
                        includeMessage: true,
                      })
                    }
                    className="btn-haus-fill flex-1 rounded-lg px-6 py-3 font-semibold"
                  >
                    Yes
                  </button>
                  <button
                    type="button"
                    onClick={() =>
                      setRegenerateEventModal({
                        ...regenerateEventModal,
                        step: 'confirm',
                        includeMessage: false,
                        message: '',
                      })
                    }
                    className="btn-haus-outline flex-1 rounded-lg px-6 py-3"
                  >
                    No
                  </button>
                </div>
                <button type="button" onClick={close} className="mt-4 w-full text-sm text-white/50 hover:text-white/80">
                  Cancel
                </button>
              </>
            )}

            {step === 'message-input' && (
              <>
                <h2 id="regenerate-event-title" className="text-2xl font-bold text-white mb-4">
                  Include a message
                </h2>
                <label className="block text-sm text-white/65 mb-2" htmlFor="regenerate-event-message">
                  Message for attendees (e.g. &ldquo;Please note the change of time&rdquo;)
                </label>
                <textarea
                  id="regenerate-event-message"
                  value={message}
                  onChange={(e) =>
                    setRegenerateEventModal({ ...regenerateEventModal, message: e.target.value })
                  }
                  rows={4}
                  className="w-full rounded-lg border border-white/[0.12] bg-white/[0.04] px-3 py-2 text-white placeholder:text-white/40 focus:outline-none focus:ring-2 focus:ring-[#A78BFA]"
                  placeholder="Please note the change of time"
                />
                <div className="flex gap-3 mt-6">
                  <button
                    type="button"
                    onClick={() =>
                      setRegenerateEventModal({ ...regenerateEventModal, step: 'confirm' })
                    }
                    disabled={!message.trim()}
                    className="btn-haus-fill flex-1 rounded-lg px-6 py-3 font-semibold disabled:opacity-50"
                  >
                    Continue
                  </button>
                  <button
                    type="button"
                    onClick={() =>
                      setRegenerateEventModal({ ...regenerateEventModal, step: 'message-choice' })
                    }
                    className="btn-haus-outline flex-1 rounded-lg px-6 py-3"
                  >
                    Back
                  </button>
                </div>
              </>
            )}

            {step === 'confirm' && (
              <>
                <h2 id="regenerate-event-title" className="text-2xl font-bold text-white mb-4">
                  Are you sure?
                </h2>
                <p className="text-white/65 mb-4">
                  This will email <strong className="text-white">{bookingsCount}</strong> confirmed attendee
                  {bookingsCount === 1 ? '' : 's'} for <strong className="text-white">{event.name}</strong> with
                  updated confirmation emails.
                </p>
                {includeMessage && message.trim() && (
                  <div className="mb-4 rounded-lg border border-amber-400/35 bg-amber-500/10 p-3 text-sm text-amber-100 whitespace-pre-wrap">
                    {message.trim()}
                  </div>
                )}
                <div className="flex gap-3">
                  <button
                    type="button"
                    onClick={runRegenerate}
                    disabled={isSending || bookingsCount === 0}
                    className="btn-haus-fill flex-1 rounded-lg px-6 py-3 font-semibold disabled:opacity-50"
                  >
                    {isSending ? 'Sending…' : 'Regenerate'}
                  </button>
                  <button
                    type="button"
                    onClick={close}
                    disabled={isSending}
                    className="btn-haus-outline flex-1 rounded-lg px-6 py-3 disabled:opacity-50"
                  >
                    Cancel
                  </button>
                </div>
                {bookingsCount === 0 && (
                  <p className="mt-3 text-sm text-amber-200">This event has no confirmed bookings.</p>
                )}
              </>
            )}
          </div>
        </div>
      </div>
    )
  }

  if (eventEditor === 'edit' && editEventId && editorRouteEventError) {
    return (
      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-8">
        <p className="text-red-400 mb-3">This event could not be loaded.</p>
        <button
          type="button"
          className="btn-haus-outline px-4 py-2 rounded-lg"
          onClick={() => window.location.assign('/admin')}
        >
          Back to admin
        </button>
      </div>
    )
  }

  if (eventEditor === 'edit' && editEventId && editorRouteEventLoading && !editorRouteEvent) {
    return (
      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-8 text-[#A78BFA]">Loading event…</div>
    )
  }

  if (eventEditor) {
    return (
      <>
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-8">
          <div className="flex flex-wrap items-center gap-4 mb-6">
            <button
              type="button"
              className="btn-haus-outline px-4 py-2 rounded-lg"
              onClick={() => leaveEventEditorToAdmin()}
            >
              ← Back to admin
            </button>
            <h1 className="text-2xl font-bold text-white">{eventEditor === 'create' ? 'Create event' : 'Edit event'}</h1>
          </div>
          {renderEventFormCard()}
        </div>
        {renderConfirmModal()}
        {renderTestBookingDeleteModal()}
        {renderRegenerateEventModal()}
      </>
    )
  }

  return (
    <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-8">
      <div className="flex justify-between items-center mb-6 flex-wrap gap-3">
        <h1 className="text-2xl sm:text-3xl font-bold text-white">Admin Dashboard</h1>
        {activeTab === 'events' && eventsListView === 'active' && (
          <div className="flex items-center gap-2">
            <button
              onClick={() => {
                setShowBulkUploadModal(true)
                setBulkUploadFile(null)
                setBulkUploadIsProcessing(false)
                setBulkUploadResults([])
                setBulkUploadProgress(null)
              }}
              className="btn-haus-outline px-6 py-2 rounded-lg"
            >
              Bulk Upload
            </button>
            <button
              type="button"
              onClick={() => {
                eventImageDrafts.forEach((d) => {
                  if (d.kind === 'new') URL.revokeObjectURL(d.preview_url)
                })
                setEventImageDrafts([])
                setDeletedEventImageDrafts([])
                setEventImagesLoading(false)
                setEventImagesUploading(false)
                leaveAdminToEventEditor('/admin/events/create')
              }}
              className="btn-haus-fill px-6 py-2 rounded-lg"
            >
              Create Event
            </button>
          </div>
        )}
        {activeTab === 'legal' && contentManagementTab === 'carousel' && (
          <button
            onClick={() => {
              if (showCarouselForm || editingCarouselItem) {
                handleCarouselCancel()
              } else {
                setShowCarouselForm(true)
                setEditingCarouselItem(null)
              }
            }}
            className={
              showCarouselForm || editingCarouselItem
                ? 'btn-haus-outline px-6 py-2 rounded-lg'
                : 'btn-haus-fill px-6 py-2 rounded-lg'
            }
          >
            {showCarouselForm || editingCarouselItem ? 'Cancel' : 'Add Carousel Item'}
          </button>
        )}
      </div>

      {/* Tabs: labeled sections toggle on mobile (not a duplicate site hamburger), horizontal nav on md+ */}
      <div className="border-b border-white/[0.12] mb-6">
        <div className="flex items-center justify-between gap-2">
          <button
            type="button"
            onClick={() => setMobileMenuOpen((o) => !o)}
            className="md:hidden inline-flex min-h-[44px] items-center gap-2 rounded-lg border border-white/[0.15] px-3 py-2 text-sm font-medium text-white/85 hover:bg-white/[0.08] hover:text-white aria-expanded:bg-white/[0.08]"
            aria-expanded={mobileMenuOpen}
            aria-controls="admin-mobile-menu"
            aria-label={mobileMenuOpen ? 'Close admin sections' : 'Open admin sections'}
          >
            {mobileMenuOpen ? (
              <svg className="w-5 h-5 shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24" aria-hidden>
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
              </svg>
            ) : (
              <svg className="w-5 h-5 shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24" aria-hidden>
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 6h16M4 12h16M4 18h16" />
              </svg>
            )}
            <span>Admin sections</span>
          </button>
          <nav
            className="hidden md:flex flex-wrap gap-1 space-x-6 lg:space-x-8"
            role="tablist"
            aria-label="Admin sections"
            onKeyDown={handleTabListKeyDown}
          >
            {adminTabs.map((tab) => {
              const selected = adminNavTabSelected(tab)
              const panelId =
                tab.key === 'users' && selected
                  ? activeTab === 'loyalty'
                    ? 'panel-loyalty'
                    : activeTab === 'redemptions'
                      ? 'panel-redemptions'
                      : 'panel-users'
                  : tab.key === 'reporting-monitoring' && selected
                    ? activeTab === 'monitoring'
                      ? 'panel-monitoring'
                      : 'panel-reporting'
                    : `panel-${tab.key}`
              return (
                <button
                  key={tab.key}
                  onClick={tab.onClick}
                  id={`tab-${tab.key}`}
                  role="tab"
                  aria-selected={selected}
                  aria-controls={panelId}
                  tabIndex={selected ? 0 : -1}
                  className={`py-4 px-1 border-b-2 font-medium text-sm whitespace-nowrap ${
                    selected
                      ? 'border-primary text-primary'
                      : 'border-transparent text-white/50 hover:text-white/75 hover:border-white/[0.15]'
                  }`}
                >
                  {tab.label}
                </button>
              )
            })}
          </nav>
        </div>
        <div
          id="admin-mobile-menu"
          className={`md:hidden overflow-hidden transition-[height,opacity] duration-200 ${
            mobileMenuOpen
              ? 'max-h-[80vh] opacity-100 pointer-events-auto'
              : 'max-h-0 opacity-0 pointer-events-none'
          }`}
          aria-hidden={!mobileMenuOpen}
        >
          <nav className="flex flex-col gap-1 py-3 border-t border-white/[0.12] mt-2" role="tablist" aria-label="Admin sections (mobile)">
            <div className="mb-2 flex flex-col gap-1 border-b border-white/[0.12] pb-2">
              <p className="px-3 text-xs font-medium uppercase tracking-wide text-white/45">Leave admin</p>
              <button
                type="button"
                className="btn-haus-ghost text-white/75 text-sm py-3 px-3 w-full text-left rounded-lg"
                onClick={() => {
                  closeMobileMenu()
                  window.location.assign('/')
                }}
              >
                Home
              </button>
              <button
                type="button"
                className="btn-haus-ghost text-white/75 text-sm py-3 px-3 w-full text-left rounded-lg"
                onClick={() => {
                  closeMobileMenu()
                  window.location.assign('/dashboard')
                }}
              >
                My Dashboard
              </button>
            </div>
            {adminTabs.map((tab) => {
              const selected = adminNavTabSelected(tab)
              const panelId =
                tab.key === 'users' && selected
                  ? activeTab === 'loyalty'
                    ? 'panel-loyalty'
                    : activeTab === 'redemptions'
                      ? 'panel-redemptions'
                      : 'panel-users'
                  : tab.key === 'reporting-monitoring' && selected
                    ? activeTab === 'monitoring'
                      ? 'panel-monitoring'
                      : 'panel-reporting'
                    : `panel-${tab.key}`
              return (
                <button
                  key={tab.key}
                  onClick={tab.onClick}
                  id={`tab-mobile-${tab.key}`}
                  role="tab"
                  aria-selected={selected}
                  aria-controls={panelId}
                  tabIndex={mobileMenuOpen && selected ? 0 : -1}
                  className={tabButtonClass(tab)}
                >
                  {tab.label}
                </button>
              )
            })}
          </nav>
        </div>
      </div>

      {activeTab === 'monitoring' && (
        <div id="panel-monitoring" role="tabpanel" aria-labelledby="tab-reporting-monitoring" className="space-y-4">
          <nav className="flex flex-wrap gap-2 border-b border-white/[0.12] pb-3" aria-label="Reporting and monitoring">
            <button
              type="button"
              onClick={goReporting}
              className="px-3 py-1.5 rounded-lg text-sm font-medium bg-white/[0.08] text-white/90 hover:bg-white/[0.1]"
            >
              Reporting
            </button>
            <button
              type="button"
              onClick={goMonitoring}
              className="btn-haus-fill rounded-lg px-3 py-1.5 text-sm"
            >
              Monitoring
            </button>
          </nav>
          <div className="bg-[#0B0B0D] rounded-xl shadow-sm p-6 border border-white/[0.12]">
            <div className="flex items-center justify-between mb-4">
              <div>
                <h2 className="text-xl font-semibold text-white">Security Events</h2>
                <p className="text-sm text-white/50">Recent security and operational alerts (webhook failures, rate limits, etc.).</p>
              </div>
              <div className="flex items-center gap-3">
                <div className="text-sm text-white/50">
                  Total: {securityEventsData?.total ?? 0}
                </div>
                <button
                  type="button"
                  onClick={() => {
                    setConfirmModal({
                      show: true,
                      title: 'Clear security events?',
                      message: 'This will permanently delete all security events from the log. This action cannot be undone.',
                      confirmText: 'Clear Events',
                      cancelText: 'Cancel',
                      confirmButtonClass: 'bg-red-600 hover:bg-red-700',
                      onConfirm: () => {
                        setConfirmModal(null)
                        clearSecurityEventsMutation.mutate()
                      },
                    })
                  }}
                  disabled={clearSecurityEventsMutation.isPending || (securityEventsData?.total ?? 0) === 0}
                  className="px-3 py-2 rounded-lg border border-red-200 text-red-700 hover:bg-red-50 disabled:opacity-50 text-sm font-medium"
                >
                  {clearSecurityEventsMutation.isPending ? 'ClearingÔÇª' : 'Clear Events'}
                </button>
              </div>
            </div>

            {isLoadingSecurityEvents ? (
              <div className="text-white/65">LoadingÔÇª</div>
            ) : securityEventsError ? (
              <div className="text-red-600">
                Failed to load security events. Ensure the admin read migration is applied and you are signed in as an admin.
              </div>
            ) : (
              <>
                <div className="overflow-x-auto">
                  <table className="min-w-full text-sm">
                    <thead>
                      <tr className="text-left text-white/50 border-b">
                        <th scope="col" className="py-2 pr-4">Time</th>
                        <th scope="col" className="py-2 pr-4">Severity</th>
                        <th scope="col" className="py-2 pr-4">Type</th>
                        <th scope="col" className="py-2 pr-4">Message</th>
                      </tr>
                    </thead>
                    <tbody>
                      {(securityEventsData?.events || []).map((e: SecurityEvent) => (
                        <tr key={e.id} className="border-b last:border-b-0">
                          <td className="py-2 pr-4 text-white/65 whitespace-nowrap">
                            {new Date(e.created_at).toLocaleString('en-GB')}
                          </td>
                          <td className="py-2 pr-4">
                            <span className={`inline-flex px-2 py-0.5 rounded-full text-xs font-medium ${
                              e.severity === 'critical' ? 'bg-red-100 text-red-800' :
                              e.severity === 'high' ? 'bg-orange-100 text-orange-800' :
                              e.severity === 'medium' ? 'bg-yellow-100 text-yellow-800' :
                              'bg-white/[0.08] text-white/90'
                            }`}>
                              {e.severity}
                            </span>
                          </td>
                          <td className="py-2 pr-4 font-mono text-xs text-white/75">{e.event_type}</td>
                          <td className="py-2 pr-4 text-white/90">{e.message}</td>
                        </tr>
                      ))}
                      {(securityEventsData?.events || []).length === 0 && (
                        <tr>
                          <td colSpan={4} className="py-4 text-white/50">No events yet.</td>
                        </tr>
                      )}
                    </tbody>
                  </table>
                </div>

                <div className="flex items-center justify-between mt-4">
                  <button
                    onClick={() => setMonitoringPage(p => Math.max(1, p - 1))}
                    disabled={monitoringPage <= 1}
                    className="px-3 py-2 rounded-lg border border-white/[0.15] text-white/75 disabled:opacity-50"
                  >
                    Prev
                  </button>
                  <div className="text-sm text-white/65">
                    Page {monitoringPage} of {Math.max(1, Math.ceil((securityEventsData?.total || 0) / monitoringPageSize))}
                  </div>
                  <button
                    onClick={() => setMonitoringPage(p => p + 1)}
                    disabled={(monitoringPage * monitoringPageSize) >= (securityEventsData?.total || 0)}
                    className="px-3 py-2 rounded-lg border border-white/[0.15] text-white/75 disabled:opacity-50"
                  >
                    Next
                  </button>
                </div>
              </>
            )}
          </div>
        </div>
      )}

      {activeTab === 'events' && (
        eventsListView === 'featured' ? (
        <div id="panel-events-featured" role="tabpanel" aria-labelledby="events-featured-heading" className="space-y-4">
          <div className="flex flex-col gap-4 lg:flex-row lg:items-start lg:justify-between">
            <div>
              <h2 id="events-featured-heading" className="text-2xl font-semibold text-white">
                Homepage featured
              </h2>
              <p className="text-sm text-white/55 mt-1 max-w-xl">
                Future events that already have at least one gallery image. Toggle featured for the homepage section (non-draft, non-hidden events with images).
              </p>
            </div>
            <div className="flex flex-wrap gap-2">
              <button type="button" onClick={() => goEventsListView('active')} className={eventsViewToggleClass('active')}>
                Active
              </button>
              <button type="button" onClick={() => goEventsListView('featured')} className={eventsViewToggleClass('featured')}>
                Featured
              </button>
              <button type="button" onClick={() => goEventsListView('completed')} className={eventsViewToggleClass('completed')}>
                Completed
              </button>
            </div>
          </div>

          {isLoadingFeaturedEligible ? (
            <YaugaLoader className="py-8" size="sm" />
          ) : featuredEligibleEvents.length === 0 ? (
            <div className="text-center py-12 text-white/50 bg-[#0B0B0D] rounded-xl border border-white/[0.12]">
              No upcoming events with images. Add gallery images to an event dated today or later, then it will appear here.
            </div>
          ) : (
            <>
              <div className="overflow-x-auto rounded-xl border border-white/[0.12] bg-[#0B0B0D]">
                <table className="min-w-full text-sm">
                  <thead>
                    <tr className="border-b border-white/[0.12] text-left text-white/50">
                      <th className="py-3 pl-4 pr-2 w-[72px]">Image</th>
                      <th className="py-3 pr-4">Event</th>
                      <th className="py-3 pr-4 whitespace-nowrap">Date</th>
                      <th className="py-3 pr-4">Where</th>
                      <th className="py-3 pr-4">Status</th>
                      <th className="py-3 pr-4 text-center">Featured</th>
                      <th className="py-3 pr-4 w-[1%]" />
                    </tr>
                  </thead>
                  <tbody>
                    {featuredPaginatedEvents.map((event) => {
                      const statusLabel = event.status.replace(/_/g, ' ')
                      const statusClass =
                        event.status === 'draft'
                          ? 'bg-white/[0.08] text-white/90'
                          : event.status === 'open'
                            ? 'bg-emerald-500/20 text-emerald-200 border border-emerald-400/35'
                            : event.status === 'collecting_interest'
                              ? 'bg-sky-500/25 text-sky-200 border border-sky-400/35'
                              : event.status === 'closed'
                                ? 'bg-red-500/25 text-red-200 border border-red-400/35'
                                : event.status === 'sold_out'
                                  ? 'bg-amber-500/25 text-amber-200 border border-amber-400/35'
                                  : 'bg-white/[0.08] text-white/90'
                      return (
                        <tr key={event.id} className="border-b border-white/[0.08] last:border-b-0">
                          <td className="py-3 pl-4 pr-2 align-middle">
                            {event.cover_image_url ? (
                              <img
                                src={event.cover_image_url}
                                alt=""
                                className="h-14 w-14 rounded-lg object-cover bg-[#070707]"
                              />
                            ) : (
                              <div className="h-14 w-14 rounded-lg bg-[#070707]" />
                            )}
                          </td>
                          <td className="py-3 pr-4 align-middle font-medium text-white">{event.name}</td>
                          <td className="py-3 pr-4 align-middle text-white/75 whitespace-nowrap">
                            {event.event_date
                              ? new Date(event.event_date).toLocaleDateString('en-GB', {
                                  weekday: 'short',
                                  day: 'numeric',
                                  month: 'short',
                                  year: 'numeric',
                                })
                              : '-'}
                          </td>
                          <td className="py-3 pr-4 align-middle text-white/75">{event.location || event.city}</td>
                          <td className="py-3 pr-4 align-middle">
                            <span className={`inline-flex rounded-full px-2 py-0.5 text-xs font-medium ${statusClass}`}>
                              {statusLabel}
                            </span>
                          </td>
                          <td className="py-3 pr-4 align-middle text-center">
                            <input
                              type="checkbox"
                              checked={event.is_featured ?? false}
                              disabled={toggleEventFeaturedMutation.isPending}
                              onChange={(e) =>
                                toggleEventFeaturedMutation.mutate({
                                  id: event.id,
                                  is_featured: e.target.checked,
                                })
                              }
                              className="h-4 w-4 rounded border-white/[0.15] text-primary focus:ring-primary"
                              aria-label={`Feature on homepage: ${event.name}`}
                            />
                          </td>
                          <td className="py-3 pr-4 align-middle">
                            <button
                              type="button"
                              onClick={() => {
                                leaveAdminToEventEditor(`/admin/events/edit/${event.id}`)
                              }}
                              className="text-sm font-medium text-primary hover:underline whitespace-nowrap"
                            >
                              Edit event
                            </button>
                          </td>
                        </tr>
                      )
                    })}
                  </tbody>
                </table>
              </div>

              {featuredEligibleTotalPages > 1 && (
                <div className="flex items-center justify-between rounded-xl border border-white/[0.12] bg-[#0B0B0D] p-4 shadow-sm">
                  <button
                    type="button"
                    onClick={() => setEventsPage((p) => Math.max(1, p - 1))}
                    disabled={eventsPage === 1}
                    className="rounded-lg border border-white/[0.15] px-4 py-2 text-sm font-medium text-white/75 hover:bg-[#070707] disabled:cursor-not-allowed disabled:opacity-50"
                  >
                    Previous
                  </button>
                  <span className="text-sm text-white/75">
                    Page {eventsPage} of {featuredEligibleTotalPages} ({featuredEligibleEvents.length} events)
                  </span>
                  <button
                    type="button"
                    onClick={() => setEventsPage((p) => Math.min(featuredEligibleTotalPages, p + 1))}
                    disabled={eventsPage === featuredEligibleTotalPages}
                    className="rounded-lg border border-white/[0.15] px-4 py-2 text-sm font-medium text-white/75 hover:bg-[#070707] disabled:cursor-not-allowed disabled:opacity-50"
                  >
                    Next
                  </button>
                </div>
              )}
            </>
          )}
        </div>
        ) : (
        <div className="space-y-6 min-w-0">
        <div className="space-y-4">
          <div className="flex justify-between items-center">
            <h2 className="text-2xl font-semibold text-white">
              {eventsListView === 'completed' ? 'Completed Events' : 'Active Events'}
            </h2>
            <div className="flex flex-wrap items-center justify-end gap-2">
              <button
                type="button"
                onClick={() => setShowFilters(!showFilters)}
                className="px-4 py-2 text-sm font-medium text-white/75 bg-[#0B0B0D] border border-white/[0.15] rounded-lg hover:bg-[#070707] transition-colors"
              >
                {showFilters ? 'Hide Filters' : 'Filter'}
              </button>
              <button type="button" onClick={() => goEventsListView('active')} className={eventsViewToggleClass('active')}>
                Active
              </button>
              <button type="button" onClick={() => goEventsListView('featured')} className={eventsViewToggleClass('featured')}>
                Featured
              </button>
              <button type="button" onClick={() => goEventsListView('completed')} className={eventsViewToggleClass('completed')}>
                Completed
              </button>
            </div>
          </div>

          {/* Filters */}
          {showFilters && (
          <div className="bg-[#0B0B0D] rounded-xl border border-white/[0.12] px-3 py-2">
            <div className="flex flex-wrap items-center gap-2">
              <input
                type="date"
                aria-label="Date from"
                title="Date from"
                value={eventsFilter.dateFrom}
                onChange={(e) => {
                  setEventsFilter({ ...eventsFilter, dateFrom: e.target.value })
                  setEventsPage(1)
                }}
                className="min-w-0 flex-1 basis-[8.5rem] px-2 py-1.5 text-xs border border-white/[0.15] rounded-lg bg-[#070707] text-white focus:ring-2 focus:ring-primary"
              />
              <span className="text-white/35 text-xs shrink-0">–</span>
              <input
                type="date"
                aria-label="Date to"
                title="Date to"
                value={eventsFilter.dateTo}
                onChange={(e) => {
                  setEventsFilter({ ...eventsFilter, dateTo: e.target.value })
                  setEventsPage(1)
                }}
                className="min-w-0 flex-1 basis-[8.5rem] px-2 py-1.5 text-xs border border-white/[0.15] rounded-lg bg-[#070707] text-white focus:ring-2 focus:ring-primary"
              />
              <input
                type="text"
                aria-label="Location"
                value={eventsFilter.location}
                onChange={(e) => {
                  setEventsFilter({ ...eventsFilter, location: e.target.value })
                  setEventsPage(1)
                }}
                placeholder="City or venue"
                className="min-w-0 flex-[1.2] basis-[8rem] px-2 py-1.5 text-xs border border-white/[0.15] rounded-lg bg-[#070707] text-white placeholder:text-white/40 focus:ring-2 focus:ring-primary"
              />
              <input
                type="text"
                aria-label="Event ID"
                value={eventsFilter.id}
                onChange={(e) => {
                  setEventsFilter({ ...eventsFilter, id: e.target.value })
                  setEventsPage(1)
                }}
                placeholder="Event ID"
                className="min-w-0 flex-[1.4] basis-[9rem] px-2 py-1.5 text-xs border border-white/[0.15] rounded-lg bg-[#070707] text-white placeholder:text-white/40 focus:ring-2 focus:ring-primary font-mono"
              />
              {(eventsFilter.dateFrom || eventsFilter.dateTo || eventsFilter.location || eventsFilter.id) && (
                <button
                  type="button"
                  onClick={() => {
                    setEventsFilter({ dateFrom: '', dateTo: '', location: '', id: '' })
                    setEventsPage(1)
                  }}
                  className="shrink-0 px-2 py-1.5 text-xs text-primary hover:underline"
                >
                  Clear
                </button>
              )}
            </div>
          </div>
          )}

          {filteredEvents.length === 0 ? (
            <div className="text-center py-12 text-white/50 bg-[#0B0B0D] rounded-xl border border-white/[0.12]">
              No events found.
            </div>
          ) : (
            <>
              <div className="overflow-x-auto rounded-xl border border-white/[0.12] bg-[#0B0B0D]">
                <table className="min-w-[640px] w-full text-left text-sm">
                  <thead>
                    <tr className="border-b border-white/[0.12] text-white/50">
                      <th scope="col" className="py-3 pl-4 pr-2 font-medium min-w-[200px]">Event</th>
                      <th scope="col" className="py-3 pr-3 font-medium">City / Date</th>
                      <th scope="col" className="py-3 pr-3 font-medium whitespace-nowrap">Bookings</th>
                      <th scope="col" className="py-3 pr-4 pl-2 font-medium text-right min-w-[22rem] w-[30%]">Actions</th>
                    </tr>
                  </thead>
                  <tbody>
                    {paginatedEvents.map((event) => (
                      <EventAdminTableRow
                        key={event.id}
                        event={event}
                        isSelected={selectedEvent?.id === event.id}
                        onRegenerate={() =>
                          setRegenerateEventModal({
                            event,
                            step: 'message-choice',
                            includeMessage: false,
                            message: '',
                            isSending: false,
                          })
                        }
                        onSelect={() => {
                          setSelectedEvent(event)
                          setEditingEvent(null)
                          setViewMode('class-list')
                        }}
                        onEdit={() => leaveAdminToEventEditor(`/admin/events/edit/${event.id}`)}
                        onUpdate={(updates) => updateEventMutation.mutate({ id: event.id, updates })}
                        onOpen={() => {
                      // If hybrid, require hybrid link, details and price
                      if (event.event_type === 'hybrid') {
                        const hybridLink = (event.hybrid_link ?? '').toString().trim()
                        const hybridDetails = (event.hybrid_details ?? '').toString().trim()
                        const hybridPriceSet = event.hybrid_price_pence != null && typeof event.hybrid_price_pence === 'number'
                        if (!hybridLink || !hybridDetails || !hybridPriceSet) {
                          const missing: string[] = []
                          if (!hybridLink) missing.push('Hybrid link')
                          if (!hybridDetails) missing.push('Hybrid details')
                          if (!hybridPriceSet) missing.push('Hybrid price')
                          toast.error(
                            `Hybrid events require: ${missing.join(', ')}. Please complete these before opening.`,
                            { duration: 5000 }
                          )
                          return
                        }
                      }
                      // Validate venue details are populated (required for opening)
                      const locationParts = parseLocation(event.location)
                      const missingFields: string[] = []
                      
                      if (!locationParts.venueName || locationParts.venueName.trim() === '') {
                        missingFields.push('Venue Name')
                      }
                      if (!locationParts.addressLine1 || locationParts.addressLine1.trim() === '') {
                        missingFields.push('Address Line 1')
                      }
                      if (!locationParts.townCity || locationParts.townCity.trim() === '') {
                        missingFields.push('Town/City')
                      }
                      if (!locationParts.postcode || locationParts.postcode.trim() === '') {
                        missingFields.push('Postcode')
                      }
                      
                      if (missingFields.length > 0) {
                        toast.error(
                          `Please populate the following venue fields before opening the event: ${missingFields.join(', ')}`,
                          { duration: 5000 }
                        )
                        return
                      }
                      
                      // Check if checklist items exist
                      if (checklistItems.length === 0) {
                        toast.error('No checklist items configured. Please add checklist items first.')
                        return
                      }
                      // Check if checklist already completed
                      checklistApi.getCompletionsForEvent(event.id).then((completions: EventChecklistCompletion[]) => {
                        if (completions.length === checklistItems.length) {
                          // Already completed, show early incentive prompt then open
                          setEventPendingOpen(event)
                          setEarlyIncentiveStep('prompt')
                          setShowEarlyIncentiveModal(true)
                        } else {
                          // Show checklist modal
                          setEventToOpen(event)
                          setChecklistCheckedItems(new Set())
                          setShowChecklistModal(true)
                        }
                      }).catch(() => {
                        // If no completions, show checklist modal
                        setEventToOpen(event)
                        setChecklistCheckedItems(new Set())
                        setShowChecklistModal(true)
                      })
                        }}
                        onDelete={() => {
                          void (async () => {
                            const { count, error } = await supabase
                              .from('tickets')
                              .select('id', { count: 'exact', head: true })
                              .eq('event_id', event.id)
                            if (error) {
                              toast.error(error.message || 'Could not check tickets for this event')
                              return
                            }
                            if ((count ?? 0) > 0) {
                              setTestBookingDelete({ event, step: 'ask', email: '' })
                              return
                            }
                            setConfirmModal({
                              show: true,
                              title: 'Delete Event',
                              message: `Are you sure you want to delete "${event.name}"? This cannot be undone.`,
                              confirmText: 'Delete',
                              cancelText: 'Cancel',
                              confirmButtonClass: 'bg-red-500 hover:bg-red-600',
                              onConfirm: () => {
                                deleteEventMutation.mutate(event.id)
                                setConfirmModal(null)
                              },
                            })
                          })()
                        }}
                        onReassignManager={() => {
                          setEventToReassign(event)
                          setReassignAllEvents(false)
                          setShowReassignModal(true)
                        }}
                        promotions={eventPromotions.filter((row) => row.event_id === event.id)}
                        onPromote={() => setPromoteEvent(event)}
                      />
                    ))}
                  </tbody>
                </table>
              </div>

              {/* Pagination */}
              {totalPages > 1 && (
                <div className="flex justify-between items-center mt-4 bg-[#0B0B0D] rounded-xl shadow-sm p-4 border border-white/[0.12]">
                  <button
                    onClick={() => setEventsPage(p => Math.max(1, p - 1))}
                    disabled={eventsPage === 1}
                    className="px-4 py-2 text-sm font-medium text-white/75 bg-[#0B0B0D] border border-white/[0.15] rounded-lg hover:bg-[#070707] disabled:opacity-50 disabled:cursor-not-allowed"
                  >
                    Previous
                  </button>
                  <span className="text-sm text-white/75">
                    Page {eventsPage} of {totalPages} ({filteredEvents.length} events)
                  </span>
                  <button
                    onClick={() => setEventsPage(p => Math.min(totalPages, p + 1))}
                    disabled={eventsPage === totalPages}
                    className="px-4 py-2 text-sm font-medium text-white/75 bg-[#0B0B0D] border border-white/[0.15] rounded-lg hover:bg-[#070707] disabled:opacity-50 disabled:cursor-not-allowed"
                  >
                    Next
                  </button>
                </div>
              )}
            </>
          )}
        </div>

          {selectedEvent && (
            <div
              ref={selectedEventPanelRef}
              className="bg-[#0B0B0D] rounded-xl shadow-sm p-6 border border-white/[0.12] w-full max-h-[calc(100vh-120px)] overflow-y-auto scroll-mt-4"
            >
              <div className="flex justify-between items-start mb-4">
                <h2 className="text-2xl font-semibold text-white">{selectedEvent.name}</h2>
                <button
                  onClick={() => {
                    setSelectedEvent(null)
                    setViewMode('class-list')
                  }}
                  className="text-white/50 hover:text-white/75"
                >
                  Close
                </button>
              </div>

              {/* View Mode Tabs */}
              <div className="flex gap-2 mb-6 border-b border-white/[0.12]">
                <button
                  onClick={() => setViewMode('class-list')}
                  className={`px-4 py-2 font-medium text-sm transition-colors ${
                    viewMode === 'class-list'
                      ? 'text-primary border-b-2 border-primary'
                      : 'text-white/65 hover:text-white'
                  }`}
                >
                  Class List
                </button>
                <button
                  onClick={() => setViewMode('attendees')}
                  className={`px-4 py-2 font-medium text-sm transition-colors ${
                    viewMode === 'attendees'
                      ? 'text-primary border-b-2 border-primary'
                      : 'text-white/65 hover:text-white'
                  }`}
                >
                  Attendee Report
                </button>
                <button
                  onClick={() => setViewMode('revenue')}
                  className={`px-4 py-2 font-medium text-sm transition-colors ${
                    viewMode === 'revenue'
                      ? 'text-primary border-b-2 border-primary'
                      : 'text-white/65 hover:text-white'
                  }`}
                >
                  Revenue Report
                </button>
              </div>

              {/* Class List View */}
              {viewMode === 'class-list' && (
                <>
                  {eventTickets.length === 0 ? (
                    <p className="text-white/50">No tickets sold yet.</p>
                  ) : (
                    <div className="overflow-x-auto">
                      <table className="min-w-full divide-y divide-white/[0.12]">
                        <thead className="bg-[#070707]">
                          <tr>
                            <th className="px-6 py-3 text-left text-xs font-medium text-white/50 uppercase tracking-wider">
                              Name
                            </th>
                            <th className="px-6 py-3 text-left text-xs font-medium text-white/50 uppercase tracking-wider">
                              Email
                            </th>
                            <th className="px-6 py-3 text-left text-xs font-medium text-white/50 uppercase tracking-wider">
                              Status
                            </th>
                            <th className="px-6 py-3 text-left text-xs font-medium text-white/50 uppercase tracking-wider">
                              Date
                            </th>
                            <th className="px-6 py-3 text-left text-xs font-medium text-white/50 uppercase tracking-wider">
                              Price
                            </th>
                          </tr>
                        </thead>
                        <tbody className="bg-[#0B0B0D] divide-y divide-white/[0.12]">
                          {eventTickets.map((ticket) => (
                            <tr key={ticket.id}>
                              <td className="px-6 py-4 whitespace-nowrap text-sm font-medium text-white">
                                {ticket.purchaser_name}
                              </td>
                              <td className="px-6 py-4 whitespace-nowrap text-sm text-white/50">
                                {ticket.member_email}
                              </td>
                              <td className="px-6 py-4 whitespace-nowrap text-sm text-white/50">
                                {ticket.status}
                              </td>
                              <td className="px-6 py-4 whitespace-nowrap text-sm text-white/50">
                                {new Date(ticket.transaction_date).toLocaleDateString('en-GB')}
                              </td>
                              <td className="px-6 py-4 whitespace-nowrap text-sm text-white/50">
                                £{(ticket.price_pence / 100).toFixed(2)}
                              </td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                  )}
                  {eventPickupReport.length > 0 && (
                    <div className="mt-8">
                      <h3 className="text-lg font-semibold text-white mb-2">Collect at event - add-ons</h3>
                      <p className="text-sm text-white/65 mb-3">
                        Customers who chose to collect merchandise at this event. Pending = not yet marked collected at check-in.
                      </p>
                      <div className="overflow-x-auto border border-white/[0.12] rounded-lg">
                        <table className="min-w-full divide-y divide-white/[0.12]">
                          <thead className="bg-[#070707]">
                            <tr>
                              <th className="px-4 py-2 text-left text-xs font-medium text-white/50 uppercase">Name</th>
                              <th className="px-4 py-2 text-left text-xs font-medium text-white/50 uppercase">Order</th>
                              <th className="px-4 py-2 text-left text-xs font-medium text-white/50 uppercase">Pending qty</th>
                              <th className="px-4 py-2 text-left text-xs font-medium text-white/50 uppercase">Collected qty</th>
                              <th className="px-4 py-2 text-left text-xs font-medium text-white/50 uppercase">Lines</th>
                            </tr>
                          </thead>
                          <tbody className="bg-[#0B0B0D] divide-y divide-white/[0.12]">
                            {eventPickupReport.map((row) => (
                              <tr key={row.ticketId}>
                                <td className="px-4 py-2 text-sm text-white">{row.purchaserName}</td>
                                <td className="px-4 py-2 text-sm font-mono text-white/75">{row.orderRef}</td>
                                <td className="px-4 py-2 text-sm tabular-nums">{row.pendingQty}</td>
                                <td className="px-4 py-2 text-sm tabular-nums">{row.collectedQty}</td>
                                <td className="px-4 py-2 text-sm text-white/75">
                                  {row.lines.map((l, i) => (
                                    <span key={i} className="block">
                                      {l.name} × {l.quantity}
                                      {l.collected ? ' ✓' : ' (pending)'}
                                    </span>
                                  ))}
                                </td>
                              </tr>
                            ))}
                          </tbody>
                        </table>
                      </div>
                    </div>
                  )}
                </>
              )}

              {/* Attendee Report View */}
              {viewMode === 'attendees' && (
                <>
                  {eventAttendees.length === 0 ? (
                    <p className="text-white/50">No attendees yet.</p>
                  ) : (
                    <>
                      {/* Attendance Summary */}
                      <div className="mb-4 p-4 bg-[#070707] rounded-lg border border-white/[0.12]">
                        <div className="grid grid-cols-3 md:grid-cols-5 gap-4">
                          <div>
                            <p className="text-sm text-white/65">Total Tickets</p>
                            <p className="text-2xl font-bold text-white">{eventAttendees.length}</p>
                          </div>
                          <div>
                            <p className="text-sm text-white/65">Attended</p>
                            <p className="text-2xl font-bold text-green-600">
                              {eventAttendees.filter(t => t.checked_in_at && !t.dna).length}
                            </p>
                          </div>
                          <div>
                            <p className="text-sm text-white/65">Did Not Attend</p>
                            <p className="text-2xl font-bold text-red-600">
                              {eventAttendees.filter(t => t.dna === true).length}
                            </p>
                          </div>
                          <div className="col-span-1 md:col-span-2">
                            <p className="text-sm text-white/65">
                              Checked in by: <span className="font-medium text-white">
                                {eventAttendees.filter(t => t.checked_in_by).length > 0
                                  ? Array.from(new Set(eventAttendees.filter(t => t.checked_in_by).map(t => t.checked_in_by))).join(', ')
                                  : '-'}
                              </span>
                            </p>
                            <p className="text-sm text-white/65 mt-1">
                              Checked out by: <span className="font-medium text-white">
                                {eventAttendees.filter(t => t.checked_out_by).length > 0
                                  ? Array.from(new Set(eventAttendees.filter(t => t.checked_out_by).map(t => t.checked_out_by))).join(', ')
                                  : '-'}
                              </span>
                            </p>
                          </div>
                        </div>
                      </div>
                      <div className="overflow-x-auto">
                        <table className="min-w-full divide-y divide-white/[0.12]">
                        <thead className="bg-[#070707]">
                          <tr>
                            <th className="px-6 py-3 text-left text-xs font-medium text-white/50 uppercase tracking-wider">
                              Name
                            </th>
                            <th className="px-6 py-3 text-left text-xs font-medium text-white/50 uppercase tracking-wider">
                              Email
                            </th>
                            <th className="px-6 py-3 text-left text-xs font-medium text-white/50 uppercase tracking-wider">
                              Status
                            </th>
                            <th className="px-6 py-3 text-left text-xs font-medium text-white/50 uppercase tracking-wider">
                              Checked In
                            </th>
                            <th className="px-6 py-3 text-left text-xs font-medium text-white/50 uppercase tracking-wider">
                              Check-in Time
                            </th>
                            <th className="px-6 py-3 text-left text-xs font-medium text-white/50 uppercase tracking-wider">
                              Check-out Time
                            </th>
                          </tr>
                        </thead>
                        <tbody className="bg-[#0B0B0D] divide-y divide-white/[0.12]">
                          {eventAttendees.map((ticket) => {
                            const checkedIn = ticket.checked_in_at && !ticket.dna
                            const isDNA = ticket.dna === true
                            return (
                              <tr key={ticket.id}>
                                <td className="px-6 py-4 whitespace-nowrap text-sm font-medium text-white">
                                  {ticket.purchaser_name}
                                </td>
                                <td className="px-6 py-4 whitespace-nowrap text-sm text-white/50">
                                  {ticket.member_email}
                                </td>
                                <td className="px-6 py-4 whitespace-nowrap text-sm text-white/50">
                                  <span className={`px-2 py-1 rounded-full text-xs font-medium ${
                                    ticket.status === 'booked'
                                      ? 'bg-emerald-500/20 text-emerald-200 border border-emerald-400/35'
                                      : 'bg-amber-500/20 text-amber-200 border border-amber-400/35'
                                  }`}>
                                    {ticket.status}
                                  </span>
                                </td>
                                <td className="px-6 py-4 whitespace-nowrap text-sm">
                                  {isDNA ? (
                                    <span className="text-red-600 font-medium">DNA</span>
                                  ) : checkedIn ? (
                                    <span className="text-green-600 font-medium">Yes</span>
                                  ) : (
                                    <span className="text-white/40">No</span>
                                  )}
                                </td>
                                <td className="px-6 py-4 whitespace-nowrap text-sm text-white/50">
                                  {checkedIn && ticket.checked_in_at
                                    ? new Date(ticket.checked_in_at).toLocaleString('en-GB')
                                    : '-'}
                                </td>
                                <td className="px-6 py-4 whitespace-nowrap text-sm text-white/50">
                                  {ticket.checked_out_at
                                    ? new Date(ticket.checked_out_at).toLocaleString('en-GB')
                                    : '-'}
                                </td>
                              </tr>
                            )
                          })}
                        </tbody>
                      </table>
                    </div>
                    </>
                  )}
                </>
              )}

              {/* Revenue Report View */}
              {viewMode === 'revenue' && (
                <>
                  {eventRevenue ? (
                    <div className="space-y-6">
                      <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                        <div className="rounded-lg border border-white/[0.12] bg-[#101014] p-4">
                          <h3 className="text-sm font-medium text-white/65 mb-1">Total Revenue</h3>
                          <p className="text-2xl font-bold text-[#A78BFA]">
                            £{eventRevenue.totalRevenue.toFixed(2)}
                          </p>
                        </div>
                        <div className="rounded-lg border border-white/[0.12] bg-[#101014] p-4">
                          <h3 className="text-sm font-medium text-white/65 mb-1">Total Tickets</h3>
                          <p className="text-2xl font-bold text-white">{eventRevenue.totalTickets}</p>
                        </div>
                        <div className="rounded-lg border border-white/[0.12] bg-[#101014] p-4">
                          <h3 className="text-sm font-medium text-white/65 mb-1">Paid Tickets</h3>
                          <p className="text-2xl font-bold text-emerald-400">{eventRevenue.paidTickets}</p>
                        </div>
                      </div>
                      <div className="bg-[#070707] rounded-lg p-4">
                        <h3 className="font-semibold text-white mb-2">Revenue Breakdown</h3>
                        <div className="space-y-2 text-sm">
                          <div className="flex justify-between">
                            <span className="text-white/65">Average Ticket Price:</span>
                            <span className="font-medium text-white">
                              £{eventRevenue.averageTicketPrice.toFixed(2)}
                            </span>
                          </div>
                          <div className="flex justify-between">
                            <span className="text-white/65">Conversion Rate:</span>
                            <span className="font-medium text-white">
                              {eventRevenue.totalTickets > 0
                                ? ((eventRevenue.paidTickets / eventRevenue.totalTickets) * 100).toFixed(1)
                                : '0'}%
                            </span>
                          </div>
                          {eventRevenue.refundedTickets > 0 && (
                            <div className="flex justify-between">
                              <span className="text-white/65">Refunded Tickets:</span>
                              <span className="font-medium text-red-600">{eventRevenue.refundedTickets}</span>
                            </div>
                          )}
                          {eventRevenue.cancelledTickets > 0 && (
                            <div className="flex justify-between">
                              <span className="text-white/65">Cancelled Tickets:</span>
                              <span className="font-medium text-orange-600">{eventRevenue.cancelledTickets}</span>
                            </div>
                          )}
                        </div>
                      </div>
                    </div>
                  ) : (
                    <p className="text-white/50">Loading revenue data...</p>
                  )}
                </>
              )}
            </div>
          )}
        </div>
        )
      )}

      {activeTab === 'reporting' && (
        <div id="panel-reporting" role="tabpanel" aria-labelledby="tab-reporting-monitoring" className="space-y-6">
          <nav className="flex flex-wrap gap-2 border-b border-white/[0.12] pb-3" aria-label="Reporting and monitoring">
            <button
              type="button"
              onClick={goReporting}
              className="btn-haus-fill rounded-lg px-3 py-1.5 text-sm"
            >
              Reporting
            </button>
            <button
              type="button"
              onClick={goMonitoring}
              className="px-3 py-1.5 rounded-lg text-sm font-medium bg-white/[0.08] text-white/90 hover:bg-white/[0.1]"
            >
              Monitoring
            </button>
          </nav>
          <div
            className="flex flex-wrap gap-2 border-b border-white/[0.12] pb-4 mb-2"
            role="tablist"
            aria-label="Reporting sections"
          >
            <button
              type="button"
              role="tab"
              id="reporting-sub-dashboard"
              aria-controls="reporting-dashboard-panel"
              aria-selected={reportingSubTab === 'dashboard'}
              onClick={() => setReportingSubTab('dashboard')}
              className={`px-4 py-2 rounded-lg text-sm font-medium transition-colors ${
                reportingSubTab === 'dashboard'
                  ? 'btn-haus-fill'
                  : 'btn-haus-ghost'
              }`}
            >
              Dashboard
            </button>
            <button
              type="button"
              role="tab"
              id="reporting-sub-location-votes"
              aria-controls="reporting-location-votes-panel"
              aria-selected={reportingSubTab === 'location-votes'}
              onClick={() => setReportingSubTab('location-votes')}
              className={`px-4 py-2 rounded-lg text-sm font-medium transition-colors ${
                reportingSubTab === 'location-votes'
                  ? 'btn-haus-fill'
                  : 'btn-haus-ghost'
              }`}
            >
              Location votes
            </button>
            <button
              type="button"
              role="tab"
              id="reporting-sub-city-lead-sources"
              aria-controls="reporting-city-lead-sources-panel"
              aria-selected={reportingSubTab === 'city-lead-sources'}
              onClick={() => setReportingSubTab('city-lead-sources')}
              className={`px-4 py-2 rounded-lg text-sm font-medium transition-colors ${
                reportingSubTab === 'city-lead-sources'
                  ? 'btn-haus-fill'
                  : 'btn-haus-ghost'
              }`}
            >
              City lead sources
            </button>
          </div>
          {reportingSubTab === 'dashboard' && (
          <>
          <div id="reporting-dashboard-panel" role="tabpanel" aria-labelledby="reporting-sub-dashboard" className="bg-[#0B0B0D] rounded-xl shadow-sm p-6 border border-white/[0.12]">
            <h2 className="text-2xl font-semibold text-white mb-6">Reporting Dashboard</h2>
            
            {bookingStats ? (
              <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-6">
                {/* Total Bookings Pie Chart */}
                <div className="bg-[#070707] rounded-lg p-4 border border-white/[0.12]">
                  <h3 className="text-sm font-semibold text-white mb-3">Total Bookings</h3>
                  <div className="flex flex-col items-center">
                    <div className="relative w-40 h-40 mb-3">
                      <svg viewBox="0 0 100 100" className="transform -rotate-90 w-full h-full">
                        <circle
                          cx="50"
                          cy="50"
                          r="45"
                          fill="none"
                          stroke="#e5e7eb"
                          strokeWidth="10"
                        />
                        {bookingStats.totalBookings > 0 && (
                          <circle
                            cx="50"
                            cy="50"
                            r="45"
                            fill="none"
                            stroke="#8277FF"
                            strokeWidth="10"
                            strokeDasharray={`${(bookingStats.totalBookings / (bookingStats.totalBookings + bookingStats.totalPreRegistrations || 1)) * 283} 283`}
                            strokeLinecap="round"
                          />
                        )}
                      </svg>
                      <div className="absolute inset-0 flex items-center justify-center">
                        <div className="text-center">
                          <div className="text-2xl font-bold text-primary">{bookingStats.totalBookings}</div>
                          <div className="text-xs text-white/65">Bookings</div>
                        </div>
                      </div>
                    </div>
                    <div className="space-y-1 text-xs w-full">
                      <div className="flex items-center justify-between">
                        <div className="flex items-center gap-2">
                          <div className="w-3 h-3 bg-primary rounded"></div>
                          <span className="text-white/75">Bookings</span>
                        </div>
                        <strong>{bookingStats.totalBookings}</strong>
                      </div>
                      <div className="flex items-center justify-between">
                        <div className="flex items-center gap-2">
                          <div className="w-3 h-3 bg-white/25 rounded"></div>
                          <span className="text-white/75">Pre-Reg</span>
                        </div>
                        <strong>{bookingStats.totalPreRegistrations}</strong>
                      </div>
                      <div className="flex items-center justify-between">
                        <div className="flex items-center gap-2">
                          <div className="w-3 h-3 bg-orange-400 rounded"></div>
                          <span className="text-white/75">Cancellations</span>
                        </div>
                        <strong>{bookingStats.totalCancellations ?? 0}</strong>
                      </div>
                    </div>
                  </div>
                </div>

                {/* Bookings: Attendees Breakdown */}
                <div className="bg-[#070707] rounded-lg p-4 border border-white/[0.12]">
                  <h3 className="text-sm font-semibold text-white mb-3">Bookings: Attendees</h3>
                  <div className="flex flex-col items-center">
                    <div className="relative w-40 h-40 mb-3">
                      <svg viewBox="0 0 100 100" className="transform -rotate-90 w-full h-full">
                        <circle
                          cx="50"
                          cy="50"
                          r="45"
                          fill="none"
                          stroke="#e5e7eb"
                          strokeWidth="10"
                        />
                        {bookingStats.totalBookings > 0 && (
                          <>
                            <circle
                              cx="50"
                              cy="50"
                              r="45"
                              fill="none"
                              stroke="#10b981"
                              strokeWidth="10"
                              strokeDasharray={`${(bookingStats.bookingsWithAttendees / bookingStats.totalBookings) * 283} 283`}
                              strokeLinecap="round"
                            />
                            {bookingStats.bookingsWithoutAttendees > 0 && (
                              <circle
                                cx="50"
                                cy="50"
                                r="45"
                                fill="none"
                                stroke="#f59e0b"
                                strokeWidth="10"
                                strokeDasharray={`${(bookingStats.bookingsWithoutAttendees / bookingStats.totalBookings) * 283} 283`}
                                strokeDashoffset={`-${(bookingStats.bookingsWithAttendees / bookingStats.totalBookings) * 283}`}
                                strokeLinecap="round"
                              />
                            )}
                          </>
                        )}
                      </svg>
                      <div className="absolute inset-0 flex items-center justify-center">
                        <div className="text-center">
                          <div className="text-2xl font-bold text-primary">{bookingStats.totalBookings}</div>
                          <div className="text-xs text-white/65">Total</div>
                        </div>
                      </div>
                    </div>
                    <div className="space-y-1 text-xs w-full">
                      <div className="flex items-center justify-between">
                        <div className="flex items-center gap-2">
                          <div className="w-3 h-3 bg-green-500 rounded"></div>
                          <span className="text-white/75">Attended</span>
                        </div>
                        <strong>{bookingStats.bookingsWithAttendees}</strong>
                      </div>
                      <button
                        type="button"
                        onClick={() => setShowDnaDrilldown(true)}
                        disabled={bookingStats.bookingsWithoutAttendees === 0}
                        className="flex items-center justify-between w-full text-left rounded focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary focus-visible:ring-offset-2 disabled:opacity-60 disabled:cursor-not-allowed"
                        aria-label="Show events with highest Did Not Attend counts"
                      >
                        <div className="flex items-center gap-2">
                          <div className="w-3 h-3 bg-amber-500 rounded"></div>
                          <span className="text-white/75">Did Not Attend</span>
                        </div>
                        <strong>{bookingStats.bookingsWithoutAttendees}</strong>
                      </button>
                    </div>
                  </div>
                </div>

                {/* Pre-Registered to Bookings Breakdown */}
                {bookingStats.totalPreRegistrations > 0 && (
                  <div className="bg-[#070707] rounded-lg p-4 border border-white/[0.12]">
                    <h3 className="text-sm font-semibold text-white mb-3">Pre-Reg to Bookings</h3>
                    <div className="flex flex-col items-center">
                      <div className="relative w-40 h-40 mb-3">
                        <svg viewBox="0 0 100 100" className="transform -rotate-90 w-full h-full">
                          <circle
                            cx="50"
                            cy="50"
                            r="45"
                            fill="none"
                            stroke="#e5e7eb"
                            strokeWidth="10"
                          />
                          <circle
                            cx="50"
                            cy="50"
                            r="45"
                            fill="none"
                            stroke="#3b82f6"
                            strokeWidth="10"
                            strokeDasharray={`${(bookingStats.preRegistrationsConverted / bookingStats.totalPreRegistrations) * 283} 283`}
                            strokeLinecap="round"
                          />
                          {bookingStats.preRegistrationsNotConverted > 0 && (
                            <circle
                              cx="50"
                              cy="50"
                              r="45"
                              fill="none"
                              stroke="#94a3b8"
                              strokeWidth="10"
                              strokeDasharray={`${(bookingStats.preRegistrationsNotConverted / bookingStats.totalPreRegistrations) * 283} 283`}
                              strokeDashoffset={`-${(bookingStats.preRegistrationsConverted / bookingStats.totalPreRegistrations) * 283}`}
                              strokeLinecap="round"
                            />
                          )}
                        </svg>
                        <div className="absolute inset-0 flex items-center justify-center">
                          <div className="text-center">
                            <div className="text-2xl font-bold text-primary">{bookingStats.totalPreRegistrations}</div>
                            <div className="text-xs text-white/65">Pre-Reg</div>
                          </div>
                        </div>
                      </div>
                      <div className="space-y-1 text-xs w-full">
                        <div className="flex items-center justify-between">
                          <div className="flex items-center gap-2">
                            <div className="w-3 h-3 bg-blue-500 rounded"></div>
                            <span className="text-white/75">Converted</span>
                          </div>
                          <strong>{bookingStats.preRegistrationsConverted}</strong>
                        </div>
                        <div className="flex items-center justify-between">
                          <div className="flex items-center gap-2">
                            <div className="w-3 h-3 bg-slate-400 rounded"></div>
                            <span className="text-white/75">Not Converted</span>
                          </div>
                          <strong>{bookingStats.preRegistrationsNotConverted}</strong>
                        </div>
                      </div>
                    </div>
                  </div>
                )}

                {/* Cancellations */}
                <div className="bg-[#070707] rounded-lg p-4 border border-white/[0.12]">
                  <h3 className="text-sm font-semibold text-white mb-3">Cancellations</h3>
                  <div className="flex flex-col items-center">
                    <div className="text-2xl font-bold text-orange-600 mb-2">
                      {bookingStats.totalCancellations ?? 0}
                    </div>
                    <div className="text-xs text-white/65 mb-3">Refunded / cancelled</div>
                    {(bookingStats.cancellationsWithReasons?.length ?? 0) > 0 ? (
                      <div className="w-full space-y-2 max-h-48 overflow-y-auto">
                        {bookingStats.cancellationsWithReasons!.map((c, idx) => (
                          <div key={idx} className="text-xs p-2 bg-[#0B0B0D] rounded border border-white/[0.12]">
                            <div className="font-medium text-white/90 truncate" title={c.eventName}>{c.eventName}</div>
                            <div className="text-white/50 mt-0.5">
                              {c.refunded_at
                                ? new Date(c.refunded_at).toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: 'numeric' })
                                : '-'}
                            </div>
                            {c.refund_reason ? (
                              <div className="text-white/75 mt-1 italic">&ldquo;{c.refund_reason}&rdquo;</div>
                            ) : (
                              <div className="text-white/40 mt-1">No reason given</div>
                            )}
                          </div>
                        ))}
                      </div>
                    ) : (
                      <p className="text-xs text-white/50">No cancellations</p>
                    )}
                  </div>
                </div>

                {/* Popular Locations Bar Chart */}
                <div className="bg-[#070707] rounded-lg p-4 border border-white/[0.12]">
                  <h3 className="text-sm font-semibold text-white mb-3">Popular Locations</h3>
                  {popularLocations.length > 0 ? (
                    <div className="space-y-2">
                      {popularLocations.slice(0, 5).map((location, index) => {
                        const maxBookings = Math.max(...popularLocations.map(l => l.bookings), 1)
                        const barWidth = (location.bookings / maxBookings) * 100
                        return (
                          <div key={index} className="space-y-1">
                            <div className="flex items-center justify-between text-xs">
                              <span className="font-medium text-white/75 truncate flex-1">{location.city}</span>
                              <span className="text-primary font-bold ml-2">{location.bookings}</span>
                            </div>
                            <div className="w-full bg-white/10 rounded-full h-2">
                              <div
                                className="bg-primary rounded-full h-2 transition-all"
                                style={{ width: `${barWidth}%` }}
                              ></div>
                            </div>
                          </div>
                        )
                      })}
                      {popularLocations.length === 0 && (
                        <p className="text-xs text-white/50 text-center py-4">No location data</p>
                      )}
                    </div>
                  ) : (
                    <p className="text-xs text-white/50 text-center py-4">No location data</p>
                  )}
                </div>
              </div>
            ) : (
              <div className="bg-[#070707] rounded-lg p-8 text-center border border-white/[0.12]">
                <p className="text-white/50">Loading booking statistics...</p>
              </div>
            )}
          </div>

          {/* Bookings per Month */}
          <div className="bg-[#0B0B0D] rounded-xl shadow-sm p-6 border border-white/[0.12]">
            <div className="flex items-center justify-between mb-4">
              <h3 className="text-lg font-semibold text-white">Bookings per Month</h3>
              <div className="text-xs text-white/50">Last 12 months</div>
            </div>

            {bookingsByMonth.length === 0 ? (
              <div className="bg-[#070707] rounded-lg p-8 text-center border border-white/[0.12]">
                <p className="text-white/50">No booking data yet.</p>
              </div>
            ) : (
              <>
                <div
                  className="h-44 flex items-end gap-2"
                  role="img"
                  aria-label="Bar chart of bookings per month for the last 12 months"
                >
                  {bookingsByMonth.map((m) => {
                    const max = Math.max(...bookingsByMonth.map(x => x.bookings), 1)
                    const heightPct = (m.bookings / max) * 100
                    return (
                      <div key={m.monthKey} className="flex-1 flex flex-col items-center gap-2">
                        <div className="w-full flex items-end justify-center h-32">
                          <div
                            className="w-full max-w-[18px] bg-primary rounded-t"
                            style={{ height: `${Math.max(2, heightPct)}%` }}
                            title={`${m.label}: ${m.bookings} bookings`}
                          />
                        </div>
                        <div className="text-[10px] text-white/65 whitespace-nowrap">{m.label}</div>
                      </div>
                    )
                  })}
                </div>

                <table className="sr-only">
                  <caption>Bookings per month</caption>
                  <thead>
                    <tr>
                      <th scope="col">Month</th>
                      <th scope="col">Bookings</th>
                    </tr>
                  </thead>
                  <tbody>
                    {bookingsByMonth.map(m => (
                      <tr key={m.monthKey}>
                        <td>{m.label}</td>
                        <td>{m.bookings}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </>
            )}
          </div>

          {/* Ticket vs shop sales (ex VAT) - last 12 months */}
          <div className="bg-[#0B0B0D] rounded-xl shadow-sm p-6 border border-white/[0.12]">
            <div className="flex items-center justify-between mb-2">
              <h3 className="text-lg font-semibold text-white">Sales revenue (ex VAT) by month</h3>
              <div className="text-xs text-white/50">Last 12 months · platform-wide</div>
            </div>
            <p className="text-xs text-white/50 mb-4">
              Ticket and shop subtotals treated as VAT-inclusive at 20%; net ≈ gross ÷ 1.2 (same basis as ticket revenue tools).
            </p>
            {salesExVatByMonth.length === 0 ? (
              <div className="bg-[#070707] rounded-lg p-8 text-center border border-white/[0.12]">
                <p className="text-white/50">No data in range yet.</p>
              </div>
            ) : (
              <>
                <div className="flex flex-wrap gap-4 mb-4 text-xs">
                  <div className="flex items-center gap-2">
                    <span className="inline-block w-3 h-3 rounded-sm bg-primary" aria-hidden />
                    <span className="text-white/75">Tickets (ex VAT)</span>
                  </div>
                  <div className="flex items-center gap-2">
                    <span className="inline-block w-3 h-3 rounded-sm bg-emerald-600" aria-hidden />
                    <span className="text-white/75">Shop (ex VAT)</span>
                  </div>
                </div>
                <div
                  className="h-44 flex items-end gap-1.5"
                  role="img"
                  aria-label="Grouped bar chart: ticket and shop net sales per month"
                >
                  {(() => {
                    const maxNet = Math.max(
                      ...salesExVatByMonth.flatMap((r) => [r.ticketNetPence, r.shopNetPence]),
                      1
                    )
                    return salesExVatByMonth.map((m) => (
                      <div key={m.monthKey} className="flex-1 flex flex-col items-center gap-2 min-w-0">
                        <div className="w-full flex items-end justify-center gap-0.5 h-32">
                          <div
                            className="flex-1 max-w-[10px] bg-primary rounded-t"
                            style={{
                              height: `${Math.max(4, (m.ticketNetPence / maxNet) * 100)}%`,
                            }}
                            title={`Tickets: £${(m.ticketNetPence / 100).toLocaleString('en-GB', { minimumFractionDigits: 2, maximumFractionDigits: 2 })} ex VAT`}
                          />
                          <div
                            className="flex-1 max-w-[10px] bg-emerald-600 rounded-t"
                            style={{
                              height: `${Math.max(4, (m.shopNetPence / maxNet) * 100)}%`,
                            }}
                            title={`Shop: £${(m.shopNetPence / 100).toLocaleString('en-GB', { minimumFractionDigits: 2, maximumFractionDigits: 2 })} ex VAT`}
                          />
                        </div>
                        <div className="text-[10px] text-white/65 whitespace-nowrap truncate w-full text-center">
                          {m.label}
                        </div>
                      </div>
                    ))
                  })()}
                </div>
              </>
            )}
          </div>

          {/* Booking Fees by Month */}
          <div className="bg-[#0B0B0D] rounded-xl shadow-sm p-6 border border-white/[0.12]">
            <div className="flex items-center justify-between mb-4">
              <h3 className="text-lg font-semibold text-white">Booking Fees by Month</h3>
              <div className="text-xs text-white/50">Last 12 months · platform total</div>
            </div>

            {bookingFeesByMonth.length === 0 ? (
              <div className="bg-[#070707] rounded-lg p-8 text-center border border-white/[0.12]">
                <p className="text-white/50">No booking fee data yet.</p>
              </div>
            ) : (
              <>
                <div
                  className="h-44 flex items-end gap-2"
                  role="img"
                  aria-label="Bar chart of booking fees per month for the last 12 months"
                >
                  {bookingFeesByMonth.map((m) => {
                    const maxPounds = Math.max(...bookingFeesByMonth.map(x => x.bookingFeesPounds), 0.01)
                    const heightPct = (m.bookingFeesPounds / maxPounds) * 100
                    return (
                      <div key={m.monthKey} className="flex-1 flex flex-col items-center gap-2">
                        <div className="w-full flex items-end justify-center h-32">
                          <div
                            className="w-full max-w-[18px] bg-primary/80 rounded-t"
                            style={{ height: `${Math.max(2, heightPct)}%` }}
                            title={`${m.label}: £${m.bookingFeesPounds.toFixed(2)}`}
                          />
                        </div>
                        <div className="text-[10px] text-white/65 whitespace-nowrap">{m.label}</div>
                      </div>
                    )
                  })}
                </div>

                <table className="min-w-full mt-4 border border-white/[0.12] rounded-lg overflow-hidden">
                  <caption className="sr-only">Booking fees by month</caption>
                  <thead className="bg-[#070707]">
                    <tr>
                      <th scope="col" className="px-4 py-2 text-left text-xs font-medium text-white/50 uppercase">Month</th>
                      <th scope="col" className="px-4 py-2 text-right text-xs font-medium text-white/50 uppercase">Booking fees (£)</th>
                    </tr>
                  </thead>
                  <tbody className="bg-[#0B0B0D] divide-y divide-white/[0.12]">
                    {bookingFeesByMonth.map(m => (
                      <tr key={m.monthKey}>
                        <td className="px-4 py-2 text-sm text-white">{m.label}</td>
                        <td className="px-4 py-2 text-sm text-white text-right font-medium">£{m.bookingFeesPounds.toLocaleString('en-GB', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</td>
                      </tr>
                    ))}
                  </tbody>
                  <tfoot className="bg-[#070707] font-medium">
                    <tr>
                      <td className="px-4 py-2 text-sm text-white/75">Total (12 months)</td>
                      <td className="px-4 py-2 text-sm text-white text-right">
                        £{bookingFeesByMonth.reduce((s, m) => s + m.bookingFeesPounds, 0).toLocaleString('en-GB', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
                      </td>
                    </tr>
                  </tfoot>
                </table>
              </>
            )}
          </div>

          {/* Did Not Attend drilldown */}
          {showDnaDrilldown && (
            <div className="bg-[#0B0B0D] rounded-xl shadow-sm p-6 border border-white/[0.12]">
              <div className="flex items-center justify-between mb-4">
                <h3 className="text-lg font-semibold text-white">Did Not Attend: Top Events</h3>
                <button
                  type="button"
                  onClick={() => setShowDnaDrilldown(false)}
                  className="text-white/65 hover:text-white text-sm font-medium focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary focus-visible:ring-offset-2 rounded"
                >
                  Close
                </button>
              </div>

              {isLoadingTopDnaEvents ? (
                <div className="bg-[#070707] rounded-lg p-8 text-center border border-white/[0.12]">
                  <p className="text-white/50">Loading DNA events...</p>
                </div>
              ) : topDnaEvents.length === 0 ? (
                <div className="bg-[#070707] rounded-lg p-8 text-center border border-white/[0.12]">
                  <p className="text-white/50">No DNA records found yet.</p>
                </div>
              ) : (
                <div className="overflow-x-auto">
                  <table className="min-w-full divide-y divide-white/[0.12]">
                    <thead className="bg-[#070707]">
                      <tr>
                        <th scope="col" className="px-4 py-3 text-left text-xs font-medium text-white/50 uppercase">Event</th>
                        <th scope="col" className="px-4 py-3 text-left text-xs font-medium text-white/50 uppercase">Date</th>
                        <th scope="col" className="px-4 py-3 text-right text-xs font-medium text-white/50 uppercase">DNA</th>
                        <th scope="col" className="px-4 py-3 text-right text-xs font-medium text-white/50 uppercase">Bookings</th>
                        <th scope="col" className="px-4 py-3 text-right text-xs font-medium text-white/50 uppercase">DNA %</th>
                      </tr>
                    </thead>
                    <tbody className="bg-[#0B0B0D] divide-y divide-white/[0.12]">
                      {topDnaEvents.map((e) => {
                        const pct = e.totalBookings > 0 ? (e.dnaCount / e.totalBookings) * 100 : 0
                        return (
                          <tr key={e.eventId}>
                            <td className="px-4 py-3 text-sm text-white">{e.eventName}</td>
                            <td className="px-4 py-3 text-sm text-white/65">
                              {e.eventDate ? new Date(e.eventDate).toLocaleDateString('en-GB') : 'ÔÇö'}
                            </td>
                            <td className="px-4 py-3 text-sm text-white text-right">{e.dnaCount}</td>
                            <td className="px-4 py-3 text-sm text-white text-right">{e.totalBookings}</td>
                            <td className="px-4 py-3 text-sm text-white/65 text-right">{pct.toFixed(1)}%</td>
                          </tr>
                        )
                      })}
                    </tbody>
                  </table>
                </div>
              )}
            </div>
          )}

          {/* Revenue Report Section */}
          <div className="bg-[#0B0B0D] rounded-xl shadow-sm p-6 border border-white/[0.12]">
            <div className="flex justify-between items-center mb-6">
              <h2 className="text-2xl font-semibold text-white">Revenue Report</h2>
              <div className="flex gap-2">
                <button
                  onClick={() => setRevenueViewMode('platform')}
                  className={`px-4 py-2 rounded-lg text-sm font-medium transition-colors ${
                    revenueViewMode === 'platform'
                      ? 'btn-haus-fill'
                      : 'btn-haus-ghost'
                  }`}
                >
                  Platform
                </button>
                <button
                  onClick={() => setRevenueViewMode('manager')}
                  className={`px-4 py-2 rounded-lg text-sm font-medium transition-colors ${
                    revenueViewMode === 'manager'
                      ? 'btn-haus-fill'
                      : 'btn-haus-ghost'
                  }`}
                >
                  Manager
                </button>
              </div>
            </div>

            {/* Filters */}
            <div className="mb-6 grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4">
              <div>
                <label className="block text-sm font-medium text-white/75 mb-1">Filter Type</label>
                <select
                  value={revenueFilterType}
                  onChange={(e) => setRevenueFilterType(e.target.value as 'month' | 'year' | 'period')}
                  className="w-full px-3 py-2 border border-white/[0.15] rounded-lg text-sm"
                >
                  <option value="month">By Month</option>
                  <option value="year">By Year</option>
                  <option value="period">Date Range</option>
                </select>
              </div>

              {revenueFilterType === 'month' && (
                <>
                  <div>
                    <label className="block text-sm font-medium text-white/75 mb-1">Month</label>
                    <select
                      value={revenueMonth}
                      onChange={(e) => setRevenueMonth(e.target.value)}
                      className="w-full px-3 py-2 border border-white/[0.15] rounded-lg text-sm"
                    >
                      <option value="">Select Month</option>
                      {Array.from({ length: 12 }, (_, i) => {
                        const month = new Date(2024, i).toLocaleString('default', { month: 'long' })
                        return (
                          <option key={i} value={i.toString()}>
                            {month}
                          </option>
                        )
                      })}
                    </select>
                  </div>
                  <div>
                    <label className="block text-sm font-medium text-white/75 mb-1">Year</label>
                    <input
                      type="number"
                      value={revenueYear}
                      onChange={(e) => setRevenueYear(parseInt(e.target.value) || new Date().getFullYear())}
                      className="w-full px-3 py-2 border border-white/[0.15] rounded-lg text-sm"
                      min="2020"
                      max={new Date().getFullYear() + 1}
                    />
                  </div>
                </>
              )}

              {revenueFilterType === 'year' && (
                <div>
                  <label className="block text-sm font-medium text-white/75 mb-1">Year</label>
                  <input
                    type="number"
                    value={revenueYear}
                    onChange={(e) => setRevenueYear(parseInt(e.target.value) || new Date().getFullYear())}
                    className="w-full px-3 py-2 border border-white/[0.15] rounded-lg text-sm"
                    min="2020"
                    max={new Date().getFullYear() + 1}
                  />
                </div>
              )}

              {revenueFilterType === 'period' && (
                <>
                  <div>
                    <label className="block text-sm font-medium text-white/75 mb-1">Start Date</label>
                    <input
                      type="date"
                      value={revenueStartDate}
                      onChange={(e) => setRevenueStartDate(e.target.value)}
                      className="w-full px-3 py-2 border border-white/[0.15] rounded-lg text-sm"
                    />
                  </div>
                  <div>
                    <label className="block text-sm font-medium text-white/75 mb-1">End Date</label>
                    <input
                      type="date"
                      value={revenueEndDate}
                      onChange={(e) => setRevenueEndDate(e.target.value)}
                      className="w-full px-3 py-2 border border-white/[0.15] rounded-lg text-sm"
                    />
                  </div>
                </>
              )}

              {revenueViewMode === 'manager' && (
                <div>
                  <label className="block text-sm font-medium text-white/75 mb-1">Manager</label>
                  <select
                    value={selectedManagerForRevenue}
                    onChange={(e) => setSelectedManagerForRevenue(e.target.value)}
                    className="w-full px-3 py-2 border border-white/[0.15] rounded-lg text-sm"
                  >
                    <option value="">Select Manager</option>
                    {managers.map((manager) => (
                      <option key={manager.id} value={manager.email}>
                        {manager.manager_name || manager.email} ({manager.commission_percentage}%)
                      </option>
                    ))}
                  </select>
                </div>
              )}
            </div>

            {/* Platform Revenue Display */}
            {revenueViewMode === 'platform' && (
              <div>
                {platformRevenue ? (
                  <div className="space-y-6">
                    {/* Export Buttons */}
                    <div className="flex gap-2 justify-end">
                      <button
                        onClick={handleExportPlatformRevenueCSV}
                        className="btn-haus-fill flex items-center gap-2 rounded-lg px-4 py-2 text-sm"
                      >
                        <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 10v6m0 0l-3-3m3 3l3-3m2 8H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" />
                        </svg>
                        Export CSV
                      </button>
                    </div>

                    {/* Summary Cards */}
                    <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-4 gap-4">
                      <div className="rounded-lg border border-white/[0.12] bg-[#101014] p-4">
                        <div className="text-sm text-white/65 mb-1">Gross Revenue</div>
                        <div className="text-2xl font-bold text-[#A78BFA]">
                          £{platformRevenue.totalRevenue.toLocaleString('en-GB', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
                        </div>
                        {(platformRevenue.totalVAT || 0) > 0 && (
                          <div className="text-xs text-white/50 mt-1">
                            (incl. VAT: £{(platformRevenue.totalVAT || 0).toLocaleString('en-GB', { minimumFractionDigits: 2, maximumFractionDigits: 2 })})
                          </div>
                        )}
                        <div className="text-xs text-white/50 mt-2 space-y-0.5 border-t border-white/[0.08] pt-2">
                          <div>Tickets: £{(platformRevenue.ticketRevenueGross ?? 0).toLocaleString('en-GB', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</div>
                          <div>Shop: £{(platformRevenue.shopRevenueGross ?? 0).toLocaleString('en-GB', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</div>
                        </div>
                      </div>
                      <div className="rounded-lg border border-white/[0.12] bg-[#101014] p-4">
                        <div className="text-sm text-white/65 mb-1">Taxes (VAT)</div>
                        <div className="text-2xl font-bold text-[#C4B5FD]">
                          £{(platformRevenue.totalVAT || 0).toLocaleString('en-GB', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
                        </div>
                      </div>
                      <div className="rounded-lg border border-white/[0.12] bg-[#101014] p-4">
                        <div className="text-sm text-white/65 mb-1">Net Revenue</div>
                        <div className="text-2xl font-bold text-emerald-400">
                          £{(platformRevenue.totalNetRevenue || platformRevenue.totalRevenue).toLocaleString('en-GB', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
                        </div>
                        <div className="text-xs text-white/50 mt-1">(after VAT)</div>
                      </div>
                      <div className="rounded-lg border border-white/[0.12] bg-[#101014] p-4">
                        <div className="text-sm text-white/65 mb-1">Tickets &amp; shop orders</div>
                        <div className="flex flex-wrap gap-6 mt-1">
                          <div>
                            <div className="text-2xl font-bold text-white">{platformRevenue.totalTickets}</div>
                            <div className="text-xs text-white/50">Tickets sold</div>
                          </div>
                          <div>
                            <div className="text-2xl font-bold text-[#93C5FD]">{platformRevenue.totalShopOrders ?? 0}</div>
                            <div className="text-xs text-white/50">Shop orders</div>
                          </div>
                        </div>
                        <div className="text-xs text-white/65 mt-3 space-y-0.5 border-t border-white/[0.08] pt-2">
                          <div>Ticket revenue: £{(platformRevenue.ticketRevenueGross ?? 0).toLocaleString('en-GB', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</div>
                          <div>Shop revenue: £{(platformRevenue.shopRevenueGross ?? 0).toLocaleString('en-GB', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</div>
                        </div>
                      </div>
                    </div>

                    {/* Revenue by Month Chart */}
                    {platformRevenue.revenueByMonth.length > 0 && (
                      <div>
                        <h3 className="text-lg font-semibold text-white mb-4">Revenue by Month</h3>
                        <div className="space-y-2">
                          {platformRevenue.revenueByMonth.map((month, index) => {
                            const maxRevenue = Math.max(...platformRevenue.revenueByMonth.map(m => m.revenue), 1)
                            const barWidth = (month.revenue / maxRevenue) * 100
                            // Parse month string to extract year and month number
                            // Format is like "January 2024" or "December 2023"
                            const monthMatch = month.month.match(/(\w+)\s+(\d{4})/)
                            let year = new Date().getFullYear()
                            let monthIndex = new Date().getMonth()
                            
                            if (monthMatch) {
                              year = parseInt(monthMatch[2])
                              // Try to parse month name
                              try {
                                const date = new Date(`${monthMatch[1]} 1, ${year}`)
                                if (!isNaN(date.getTime())) {
                                  monthIndex = date.getMonth()
                                }
                              } catch (e) {
                                // Fallback to current month if parsing fails
                              }
                            }
                            
                            return (
                              <div 
                                key={index} 
                                className="space-y-1 cursor-pointer hover:bg-[#070707] p-2 rounded-lg transition-colors"
                                onClick={(e) => {
                                  e.preventDefault()
                                  e.stopPropagation()
                                  setSelectedMonthForDetails(`${year}-${monthIndex}`)
                                  setShowMonthDetailsModal(true)
                                }}
                              >
                                <div className="flex items-center justify-between text-sm">
                                  <span className="font-medium text-white/75">{month.month}</span>
                                  <div className="text-right">
                                    <div className="text-primary font-bold">
                                      Gross: £{month.revenue.toLocaleString('en-GB', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
                                    </div>
                                    {(month.vat || 0) > 0 && (
                                      <div className="text-xs text-white/65">
                                        VAT: £{(month.vat || 0).toLocaleString('en-GB', { minimumFractionDigits: 2, maximumFractionDigits: 2 })} | 
                                        Net: £{(month.netRevenue || month.revenue).toLocaleString('en-GB', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
                                      </div>
                                    )}
                                    <div className="text-xs text-white/50">
                                      {month.tickets} tickets
                                      {(month as { shopOrders?: number }).shopOrders
                                        ? ` · ${(month as { shopOrders?: number }).shopOrders} shop orders`
                                        : ''}
                                    </div>
                                    <div className="text-xs text-white/50">
                                      Tickets £
                                      {((month as { ticketRevenue?: number }).ticketRevenue ?? 0).toLocaleString('en-GB', {
                                        minimumFractionDigits: 2,
                                        maximumFractionDigits: 2,
                                      })}{' '}
                                      · Shop £
                                      {((month as { shopRevenue?: number }).shopRevenue ?? 0).toLocaleString('en-GB', {
                                        minimumFractionDigits: 2,
                                        maximumFractionDigits: 2,
                                      })}
                                    </div>
                                  </div>
                                </div>
                                <div className="w-full bg-white/10 rounded-full h-3">
                                  <div
                                    className="bg-primary rounded-full h-3 transition-all"
                                    style={{ width: `${barWidth}%` }}
                                  ></div>
                                </div>
                              </div>
                            )
                          })}
                        </div>
                      </div>
                    )}

                    {/* Revenue by Event / Product */}
                    {(platformRevenue.revenueByEvent.length > 0 || (platformRevenue.revenueByProduct ?? []).length > 0) && (
                      <div>
                        <div className="flex flex-wrap items-center justify-between gap-3 mb-4">
                          <h3 className="text-lg font-semibold text-white">Ticket &amp; product revenue</h3>
                          <div className="flex rounded-lg border border-white/[0.12] p-0.5 bg-[#070707]">
                            <button
                              type="button"
                              onClick={() => setPlatformRevenueSalesTab('events')}
                              className={`px-4 py-2 rounded-md text-sm font-medium transition-colors ${
                                platformRevenueSalesTab === 'events'
                                  ? 'bg-[#0B0B0D] text-white shadow-sm'
                                  : 'text-white/65 hover:text-white'
                              }`}
                            >
                              Revenue by Event
                            </button>
                            <button
                              type="button"
                              onClick={() => setPlatformRevenueSalesTab('products')}
                              className={`px-4 py-2 rounded-md text-sm font-medium transition-colors ${
                                platformRevenueSalesTab === 'products'
                                  ? 'bg-[#0B0B0D] text-white shadow-sm'
                                  : 'text-white/65 hover:text-white'
                              }`}
                            >
                              Revenue by Product
                            </button>
                          </div>
                        </div>

                        {platformRevenueSalesTab === 'events' && (
                          <div className="overflow-x-auto">
                            {platformRevenue.revenueByEvent.length === 0 ? (
                              <p className="text-sm text-white/50 py-6">No ticket revenue in this period.</p>
                            ) : (
                              <table className="min-w-full divide-y divide-white/[0.12]">
                                <thead className="bg-[#070707]">
                                  <tr>
                                    <th className="px-4 py-3 text-left text-xs font-medium text-white/50 uppercase">Event</th>
                                    <th className="px-4 py-3 text-left text-xs font-medium text-white/50 uppercase">Location</th>
                                    <th className="px-4 py-3 text-right text-xs font-medium text-white/50 uppercase">Tickets</th>
                                    <th className="px-4 py-3 text-right text-xs font-medium text-white/50 uppercase">Gross Revenue</th>
                                    <th className="px-4 py-3 text-right text-xs font-medium text-white/50 uppercase">Taxes (VAT)</th>
                                    <th className="px-4 py-3 text-right text-xs font-medium text-white/50 uppercase">Net Revenue</th>
                                  </tr>
                                </thead>
                                <tbody className="bg-[#0B0B0D] divide-y divide-white/[0.12]">
                                  {platformRevenue.revenueByEvent.map((event) => (
                                    <tr key={event.eventId}>
                                      <td className="px-4 py-3 text-sm text-white">{event.eventName}</td>
                                      <td className="px-4 py-3 text-sm text-white/65">{event.city}, {event.country}</td>
                                      <td className="px-4 py-3 text-sm text-white text-right">{event.tickets}</td>
                                      <td className="px-4 py-3 text-sm text-white text-right">
                                        £{event.revenue.toLocaleString('en-GB', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
                                      </td>
                                      <td className="px-4 py-3 text-sm text-white/65 text-right">
                                        £{(event.vat || 0).toLocaleString('en-GB', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
                                      </td>
                                      <td className="px-4 py-3 text-sm font-semibold text-primary text-right">
                                        £{(event.netRevenue || event.revenue).toLocaleString('en-GB', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
                                      </td>
                                    </tr>
                                  ))}
                                </tbody>
                              </table>
                            )}
                          </div>
                        )}

                        {platformRevenueSalesTab === 'products' && (
                          <div className="overflow-x-auto">
                            {(platformRevenue.revenueByProduct ?? []).length === 0 ? (
                              <p className="text-sm text-white/50 py-6">No shop product sales in this period.</p>
                            ) : (
                              <table className="min-w-full divide-y divide-white/[0.12]">
                                <thead className="bg-[#070707]">
                                  <tr>
                                    <th className="px-4 py-3 text-left text-xs font-medium text-white/50 uppercase">Product</th>
                                    <th className="px-4 py-3 text-left text-xs font-medium text-white/50 uppercase">SKU</th>
                                    <th className="px-4 py-3 text-right text-xs font-medium text-white/50 uppercase">Units sold</th>
                                    <th className="px-4 py-3 text-right text-xs font-medium text-white/50 uppercase">Gross revenue</th>
                                  </tr>
                                </thead>
                                <tbody className="bg-[#0B0B0D] divide-y divide-white/[0.12]">
                                  {(platformRevenue.revenueByProduct ?? [])
                                    .slice()
                                    .sort((a, b) => b.grossRevenue - a.grossRevenue)
                                    .map((p) => (
                                      <tr key={p.productId}>
                                        <td className="px-4 py-3 text-sm text-white">{p.name}</td>
                                        <td className="px-4 py-3 font-mono text-xs text-white/65">{p.sku}</td>
                                        <td className="px-4 py-3 text-sm text-white text-right">{p.unitsSold}</td>
                                        <td className="px-4 py-3 text-sm font-medium text-white text-right">
                                          £{p.grossRevenue.toLocaleString('en-GB', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
                                        </td>
                                      </tr>
                                    ))}
                                </tbody>
                              </table>
                            )}
                          </div>
                        )}
                      </div>
                    )}

                    {(platformRevenue.revenueByProduct ?? []).length > 0 && (
                      <div>
                        <h3 className="text-lg font-semibold text-white mb-4">Top selling products (by units)</h3>
                        <div className="overflow-x-auto rounded-lg border border-white/[0.12]">
                          <table className="min-w-full divide-y divide-white/[0.12]">
                            <thead className="bg-[#070707]">
                              <tr>
                                <th className="px-4 py-3 text-left text-xs font-medium text-white/50 uppercase w-12">#</th>
                                <th className="px-4 py-3 text-left text-xs font-medium text-white/50 uppercase">Product</th>
                                <th className="px-4 py-3 text-left text-xs font-medium text-white/50 uppercase">SKU</th>
                                <th className="px-4 py-3 text-right text-xs font-medium text-white/50 uppercase">Units sold</th>
                                <th className="px-4 py-3 text-right text-xs font-medium text-white/50 uppercase">Gross revenue</th>
                              </tr>
                            </thead>
                            <tbody className="bg-[#0B0B0D] divide-y divide-white/[0.12]">
                              {[...(platformRevenue.revenueByProduct ?? [])]
                                .sort((a, b) => b.unitsSold - a.unitsSold)
                                .slice(0, 20)
                                .map((p, idx) => (
                                  <tr key={p.productId}>
                                    <td className="px-4 py-3 text-sm text-white/50">{idx + 1}</td>
                                    <td className="px-4 py-3 text-sm text-white">{p.name}</td>
                                    <td className="px-4 py-3 font-mono text-xs text-white/65">{p.sku}</td>
                                    <td className="px-4 py-3 text-sm text-white text-right">{p.unitsSold}</td>
                                    <td className="px-4 py-3 text-sm text-white text-right">
                                      £{p.grossRevenue.toLocaleString('en-GB', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
                                    </td>
                                  </tr>
                                ))}
                            </tbody>
                          </table>
                        </div>
                      </div>
                    )}
                  </div>
                ) : (
                  <div className="bg-[#070707] rounded-lg p-8 text-center border border-white/[0.12]">
                    <p className="text-white/50">Loading platform revenue...</p>
                  </div>
                )}
              </div>
            )}

            {/* Manager Revenue Display */}
            {revenueViewMode === 'manager' && (
              <div className="space-y-6">
                {/* Manager Leaderboard (uses the filters above) */}
                <div className="bg-[#070707] rounded-lg p-4 border border-white/[0.12]">
                  <div className="flex items-start justify-between gap-4 mb-4">
                    <div>
                      <h3 className="text-lg font-semibold text-white">Manager Leaderboard</h3>
                      <p className="text-xs text-white/50">
                        {revenueFilterType === 'year' && revenueYear === new Date().getFullYear()
                          ? `Year-to-date (${revenueYear})`
                          : revenueFilterType === 'year'
                            ? `Year (${revenueYear})`
                            : revenueFilterType === 'month'
                              ? `Month`
                              : `Date range`}
                      </p>
                    </div>
                    {selectedManagerForRevenue && (
                      <button
                        type="button"
                        onClick={() => setSelectedManagerForRevenue('')}
                        className="text-sm font-medium text-white/75 hover:text-white focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary focus-visible:ring-offset-2 rounded"
                      >
                        Clear manager filter
                      </button>
                    )}
                  </div>

                  {isLoadingManagerLeaderboard ? (
                    <div className="bg-[#0B0B0D] rounded-lg p-6 text-center border border-white/[0.12]">
                      <p className="text-white/50">Loading leaderboard...</p>
                    </div>
                  ) : managerLeaderboard.length === 0 ? (
                    <div className="bg-[#0B0B0D] rounded-lg p-6 text-center border border-white/[0.12]">
                      <p className="text-white/50">No manager revenue data for the selected period.</p>
                    </div>
                  ) : (
                    <div className="overflow-x-auto">
                      <table className="min-w-full divide-y divide-white/[0.12]">
                        <thead className="bg-[#0B0B0D]">
                          <tr>
                            <th scope="col" className="px-4 py-3 text-left text-xs font-medium text-white/50 uppercase">Manager</th>
                            <th scope="col" className="px-4 py-3 text-right text-xs font-medium text-white/50 uppercase">Tickets</th>
                            <th scope="col" className="px-4 py-3 text-right text-xs font-medium text-white/50 uppercase">Gross</th>
                            <th scope="col" className="px-4 py-3 text-right text-xs font-medium text-white/50 uppercase">VAT</th>
                            <th scope="col" className="px-4 py-3 text-right text-xs font-medium text-white/50 uppercase">Net</th>
                            <th scope="col" className="px-4 py-3 text-right text-xs font-medium text-white/50 uppercase">Platform Share</th>
                            <th scope="col" className="px-4 py-3 text-right text-xs font-medium text-white/50 uppercase">Due</th>
                          </tr>
                        </thead>
                        <tbody className="bg-[#0B0B0D] divide-y divide-white/[0.12]">
                          {managerLeaderboard.map((row) => {
                            const isSelected = selectedManagerForRevenue === row.managerEmail
                            return (
                              <tr
                                key={row.managerEmail}
                                className={`cursor-pointer hover:bg-[#070707] transition-colors ${isSelected ? 'bg-primary/5' : ''}`}
                                onClick={() => setSelectedManagerForRevenue(row.managerEmail)}
                              >
                                <td className="px-4 py-3 text-sm text-white">
                                  <div className="font-medium">{row.managerName}</div>
                                  <div className="text-xs text-white/50">{row.managerEmail}</div>
                                </td>
                                <td className="px-4 py-3 text-sm text-white text-right">{row.totalTickets}</td>
                                <td className="px-4 py-3 text-sm text-white text-right">
                                  £{row.totalRevenue.toLocaleString('en-GB', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
                                </td>
                                <td className="px-4 py-3 text-sm text-white/65 text-right">
                                  £{(row.totalVAT || 0).toLocaleString('en-GB', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
                                </td>
                                <td className="px-4 py-3 text-sm text-white/75 text-right">
                                  £{(row.totalNetRevenue || row.totalRevenue).toLocaleString('en-GB', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
                                </td>
                                <td className="px-4 py-3 text-sm text-amber-600 text-right">
                                  £{(row.totalCommission || 0).toLocaleString('en-GB', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
                                </td>
                                <td className="px-4 py-3 text-sm font-semibold text-green-700 text-right">
                                  £{(row.totalDue || 0).toLocaleString('en-GB', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
                                </td>
                              </tr>
                            )
                          })}
                        </tbody>
                      </table>
                    </div>
                  )}
                </div>

                {!selectedManagerForRevenue ? (
                  <div className="bg-[#070707] rounded-lg p-8 text-center border border-white/[0.12]">
                    <p className="text-white/50">Select a manager (above) to view the detailed revenue report.</p>
                  </div>
                ) : managerRevenue ? (
                  <div className="space-y-6">
                    {/* Header with Download PDF Button */}
                    <div className="flex justify-between items-center">
                      <h3 className="text-lg font-semibold text-white">Manager Revenue Report</h3>
                      {managerRevenue.events.length > 0 && (
                      <div className="flex gap-2">
                        <button
                          onClick={handleExportManagerRevenueCSV}
                          className="btn-haus-fill flex items-center gap-2 rounded-lg px-4 py-2 text-sm"
                        >
                          <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 10v6m0 0l-3-3m3 3l3-3m2 8H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" />
                          </svg>
                          Export CSV
                        </button>
                        <button
                          onClick={handleDownloadManagerPDF}
                          className="btn-haus-fill rounded-lg px-4 py-2 text-sm"
                        >
                          Download PDF Report
                        </button>
                      </div>
                    )}
                    </div>

                    {/* Summary Cards */}
                    <div className="grid grid-cols-1 md:grid-cols-5 gap-4">
                      <div className="rounded-lg border border-white/[0.12] bg-[#101014] p-4">
                        <div className="text-sm text-white/65 mb-1">Total Revenue (Gross)</div>
                        <div className="text-2xl font-bold text-[#A78BFA]">
                          £{managerRevenue.totalRevenue.toLocaleString('en-GB', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
                        </div>
                        {managerRevenue.totalVAT > 0 && (
                          <div className="text-xs text-white/50 mt-1">
                            (incl. VAT: £{managerRevenue.totalVAT.toLocaleString('en-GB', { minimumFractionDigits: 2, maximumFractionDigits: 2 })})
                          </div>
                        )}
                      </div>
                      <div className="rounded-lg border border-white/[0.12] bg-[#101014] p-4">
                        <div className="text-sm text-white/65 mb-1">Net Revenue</div>
                        <div className="text-2xl font-bold text-[#C4B5FD]">
                          £{(managerRevenue.totalNetRevenue || managerRevenue.totalRevenue).toLocaleString('en-GB', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
                        </div>
                        <div className="text-xs text-white/50 mt-1">(after VAT)</div>
                      </div>
                      <div className="rounded-lg border border-white/[0.12] bg-[#101014] p-4">
                        <div className="text-sm text-white/65 mb-1">Platform Share ({managerRevenue.commissionPercentage}%)</div>
                        <div className="text-2xl font-bold text-amber-400">
                          £{managerRevenue.totalCommission.toLocaleString('en-GB', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
                        </div>
                        <div className="text-xs text-white/50 mt-1">(on net revenue)</div>
                      </div>
                      <div className="rounded-lg border border-white/[0.12] bg-[#101014] p-4">
                        <div className="text-sm text-white/65 mb-1">Total Due to Manager</div>
                        <div className="text-2xl font-bold text-emerald-400">
                          £{managerRevenue.totalDue.toLocaleString('en-GB', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
                        </div>
                        <div className="text-xs text-white/50 mt-1">(on net revenue)</div>
                      </div>
                      <div className="rounded-lg border border-white/[0.12] bg-[#101014] p-4">
                        <div className="text-sm text-white/65 mb-1">Total Tickets</div>
                        <div className="text-2xl font-bold text-white">{managerRevenue.totalTickets}</div>
                      </div>
                    </div>

                    {/* Manager Info */}
                    <div className="bg-[#070707] rounded-lg p-4 border border-white/[0.12]">
                      <div className="text-sm">
                        <span className="font-medium text-white/75">Manager:</span> {managerRevenue.managerName}
                      </div>
                      <div className="text-sm mt-1">
                        <span className="font-medium text-white/75">Platform Share:</span> {managerRevenue.commissionPercentage}%
                      </div>
                    </div>

                    {/* Events Table */}
                    {managerRevenue.events.length > 0 ? (
                      <div>
                        <h3 className="text-lg font-semibold text-white mb-4">Revenue by Event</h3>
                        <div className="overflow-x-auto">
                          <table className="min-w-full divide-y divide-white/[0.12]">
                            <thead className="bg-[#070707]">
                              <tr>
                                <th className="px-4 py-3 text-left text-xs font-medium text-white/50 uppercase">Event</th>
                                <th className="px-4 py-3 text-left text-xs font-medium text-white/50 uppercase">Date</th>
                                <th className="px-4 py-3 text-right text-xs font-medium text-white/50 uppercase">Tickets</th>
                                <th className="px-4 py-3 text-right text-xs font-medium text-white/50 uppercase">Gross Revenue</th>
                                <th className="px-4 py-3 text-right text-xs font-medium text-white/50 uppercase">VAT</th>
                                <th className="px-4 py-3 text-right text-xs font-medium text-white/50 uppercase">Net Revenue</th>
                                <th className="px-4 py-3 text-right text-xs font-medium text-white/50 uppercase">Platform Share</th>
                                <th className="px-4 py-3 text-right text-xs font-medium text-white/50 uppercase">Due to Manager</th>
                              </tr>
                            </thead>
                            <tbody className="bg-[#0B0B0D] divide-y divide-white/[0.12]">
                              {managerRevenue.events.map((event) => (
                                <tr 
                                  key={event.event_id}
                                  onClick={() => {
                                    setSelectedEventForDetails(event.event_id)
                                    setShowEventDetailsModal(true)
                                  }}
                                  className="cursor-pointer hover:bg-[#070707] transition-colors"
                                >
                                  <td className="px-4 py-3 text-sm text-white">{event.event_name}</td>
                                  <td className="px-4 py-3 text-sm text-white/65">
                                    {event.event_date ? new Date(event.event_date).toLocaleDateString() : 'N/A'}
                                  </td>
                                  <td className="px-4 py-3 text-sm text-white text-right">{event.ticket_count}</td>
                                  <td className="px-4 py-3 text-sm text-white text-right">
                                    £{event.total_revenue.toLocaleString('en-GB', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
                                  </td>
                                  <td className="px-4 py-3 text-sm text-white/65 text-right">
                                    £{(event.vat_amount || 0).toLocaleString('en-GB', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
                                  </td>
                                  <td className="px-4 py-3 text-sm text-white/75 text-right">
                                    £{(event.net_revenue || event.total_revenue).toLocaleString('en-GB', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
                                  </td>
                                  <td className="px-4 py-3 text-sm text-amber-600 text-right">
                                    £{event.commission.toLocaleString('en-GB', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
                                  </td>
                                  <td className="px-4 py-3 text-sm font-semibold text-green-600 text-right">
                                    £{event.revenue_due.toLocaleString('en-GB', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
                                  </td>
                                </tr>
                              ))}
                            </tbody>
                          </table>
                        </div>
                      </div>
                    ) : (
                      <div className="bg-[#070707] rounded-lg p-4 border border-white/[0.12] text-center">
                        <p className="text-white/50">No revenue data found for the selected period</p>
                      </div>
                    )}
                  </div>
                ) : (
                  <div className="bg-[#070707] rounded-lg p-8 text-center border border-white/[0.12]">
                    <p className="text-white/50">Loading manager revenue...</p>
                  </div>
                )}
              </div>
            )}
          </div>
          </>
          )}
          {reportingSubTab === 'location-votes' && (
            <div id="reporting-location-votes-panel" role="tabpanel" aria-labelledby="reporting-sub-location-votes">
              <AdminLocationVotesPanel />
            </div>
          )}
          {reportingSubTab === 'city-lead-sources' && (
            <div id="reporting-city-lead-sources-panel" role="tabpanel" aria-labelledby="reporting-sub-city-lead-sources">
              <AdminCityLeadSourcesPanel />
            </div>
          )}
        </div>
      )}

      {activeTab === 'legal' && (
        <div id="panel-legal" role="tabpanel" aria-labelledby="tab-legal" className="space-y-6">
          <div className="bg-[#0B0B0D] rounded-xl shadow-sm p-6 border border-white/[0.12]">
            <div className="flex flex-col gap-4 md:flex-row md:items-center md:justify-between">
              <div>
                <h2 className="text-2xl font-semibold text-white">Content Management</h2>
                <p className="text-sm text-white/65 mt-1">
                  Manage legal pages, NDAs, carousel, FAQs, checklists, image library, partner logos, WhatsApp groups, and Meditation.
                </p>
              </div>
              <div className="flex flex-wrap gap-2">
                <button
                  type="button"
                  onClick={() => {
                    setContentManagementTab('legal-pages')
                    handleFAQCancel()
                  }}
                  className={`px-4 py-2 rounded-lg text-sm font-medium transition-colors ${
                    contentManagementTab === 'legal-pages'
                      ? 'btn-haus-fill'
                      : 'btn-haus-ghost'
                  }`}
                >
                  Legal Pages
                </button>
                <button
                  type="button"
                  onClick={() => {
                    setContentManagementTab('carousel')
                    setLegalPageType(null)
                    handleFAQCancel()
                  }}
                  className={`px-4 py-2 rounded-lg text-sm font-medium transition-colors ${
                    contentManagementTab === 'carousel'
                      ? 'btn-haus-fill'
                      : 'btn-haus-ghost'
                  }`}
                >
                  Carousel
                </button>
                <button
                  type="button"
                  onClick={() => {
                    setContentManagementTab('faq')
                    setLegalPageType(null)
                  }}
                  className={`px-4 py-2 rounded-lg text-sm font-medium transition-colors ${
                    contentManagementTab === 'faq'
                      ? 'btn-haus-fill'
                      : 'btn-haus-ghost'
                  }`}
                >
                  FAQ
                </button>
                <button
                  type="button"
                  onClick={() => {
                    setContentManagementTab('checklist')
                    setLegalPageType(null)
                    handleFAQCancel()
                  }}
                  className={`px-4 py-2 rounded-lg text-sm font-medium transition-colors ${
                    contentManagementTab === 'checklist'
                      ? 'btn-haus-fill'
                      : 'btn-haus-ghost'
                  }`}
                >
                  Checklist
                </button>
                <button
                  type="button"
                  onClick={() => {
                    setContentManagementTab('location-library')
                    setLegalPageType(null)
                    handleFAQCancel()
                  }}
                  className={`px-4 py-2 rounded-lg text-sm font-medium transition-colors ${
                    contentManagementTab === 'location-library'
                      ? 'btn-haus-fill'
                      : 'btn-haus-ghost'
                  }`}
                >
                  Image Library
                </button>
                <button
                  type="button"
                  onClick={() => {
                    setContentManagementTab('hosts')
                    setLegalPageType(null)
                    handleFAQCancel()
                  }}
                  className={`px-4 py-2 rounded-lg text-sm font-medium transition-colors ${
                    contentManagementTab === 'hosts'
                      ? 'btn-haus-fill'
                      : 'btn-haus-ghost'
                  }`}
                >
                  Hosts
                </button>
                <button
                  type="button"
                  onClick={() => {
                    setContentManagementTab('rings')
                    setLegalPageType(null)
                    handleFAQCancel()
                  }}
                  className={`px-4 py-2 rounded-lg text-sm font-medium transition-colors ${
                    contentManagementTab === 'rings'
                      ? 'btn-haus-fill'
                      : 'btn-haus-ghost'
                  }`}
                >
                  Rings
                </button>
                <button
                  type="button"
                  onClick={() => {
                    setContentManagementTab('partners')
                    setLegalPageType(null)
                    handleFAQCancel()
                  }}
                  className={`px-4 py-2 rounded-lg text-sm font-medium transition-colors ${
                    contentManagementTab === 'partners'
                      ? 'btn-haus-fill'
                      : 'btn-haus-ghost'
                  }`}
                >
                  Partners
                </button>
                <button
                  type="button"
                  onClick={() => {
                    setContentManagementTab('whatsapp')
                    setLegalPageType(null)
                    handleFAQCancel()
                    handleCarouselCancel()
                  }}
                  className={`px-4 py-2 rounded-lg text-sm font-medium transition-colors ${
                    contentManagementTab === 'whatsapp'
                      ? 'btn-haus-fill'
                      : 'btn-haus-ghost'
                  }`}
                >
                  WhatsApp
                </button>
                <button
                  type="button"
                  onClick={() => {
                    setContentManagementTab('nda')
                    setLegalPageType(null)
                    handleFAQCancel()
                    handleCarouselCancel()
                  }}
                  className={`px-4 py-2 rounded-lg text-sm font-medium transition-colors ${
                    contentManagementTab === 'nda'
                      ? 'btn-haus-fill'
                      : 'btn-haus-ghost'
                  }`}
                >
                  NDA
                </button>
                <button
                  type="button"
                  onClick={() => {
                    setContentManagementTab('contracts')
                    setLegalPageType(null)
                    handleFAQCancel()
                    handleCarouselCancel()
                  }}
                  className={`px-4 py-2 rounded-lg text-sm font-medium transition-colors ${
                    contentManagementTab === 'contracts'
                      ? 'btn-haus-fill'
                      : 'btn-haus-ghost'
                  }`}
                >
                  Contract Management
                </button>
                <button
                  type="button"
                  onClick={() => {
                    setContentManagementTab('meditation')
                    setLegalPageType(null)
                    handleFAQCancel()
                    handleCarouselCancel()
                  }}
                  className={`px-4 py-2 rounded-lg text-sm font-medium transition-colors ${
                    contentManagementTab === 'meditation'
                      ? 'btn-haus-fill'
                      : 'btn-haus-ghost'
                  }`}
                >
                  Meditation
                </button>
              </div>
            </div>
          </div>

          {contentManagementTab === 'legal-pages' && (
            <div className="bg-[#0B0B0D] rounded-xl shadow-sm p-6 border border-white/[0.12]">
              <div className="grid grid-cols-3 gap-4 mb-6">
                <button
                  onClick={() => handleLegalPageSelect('privacy')}
                  className={`p-4 border-2 rounded-lg text-left transition-colors ${
                    legalPageType === 'privacy'
                      ? 'border-[#8B5CF6] bg-[#12121a] ring-1 ring-[#8B5CF6]/35'
                      : 'border-white/[0.12] hover:border-white/[0.15]'
                  }`}
                >
                  <h3 className="font-semibold text-white mb-1">Privacy Statement</h3>
                  <p className="text-sm text-white/75">Edit privacy policy content</p>
                </button>
                <button
                  onClick={() => handleLegalPageSelect('terms')}
                  className={`p-4 border-2 rounded-lg text-left transition-colors ${
                    legalPageType === 'terms'
                      ? 'border-[#8B5CF6] bg-[#12121a] ring-1 ring-[#8B5CF6]/35'
                      : 'border-white/[0.12] hover:border-white/[0.15]'
                  }`}
                >
                  <h3 className="font-semibold text-white mb-1">Terms of Use</h3>
                  <p className="text-sm text-white/75">Edit terms and conditions</p>
                </button>
                <button
                  onClick={() => handleLegalPageSelect('cookies')}
                  className={`p-4 border-2 rounded-lg text-left transition-colors ${
                    legalPageType === 'cookies'
                      ? 'border-[#8B5CF6] bg-[#12121a] ring-1 ring-[#8B5CF6]/35'
                      : 'border-white/[0.12] hover:border-white/[0.15]'
                  }`}
                >
                  <h3 className="font-semibold text-white mb-1">Cookie Statement</h3>
                  <p className="text-sm text-white/75">Edit cookie policy</p>
                </button>
                <button
                  onClick={() => handleLegalPageSelect('event_requirements')}
                  className={`p-4 border-2 rounded-lg text-left transition-colors ${
                    legalPageType === 'event_requirements'
                      ? 'border-[#8B5CF6] bg-[#12121a] ring-1 ring-[#8B5CF6]/35'
                      : 'border-white/[0.12] hover:border-white/[0.15]'
                  }`}
                >
                  <h3 className="font-semibold text-white mb-1">Event Requirements</h3>
                  <p className="text-sm text-white/75">Edit Event Requirements</p>
                </button>
                <button
                  onClick={() => handleLegalPageSelect('about')}
                  className={`p-4 border-2 rounded-lg text-left transition-colors ${
                    legalPageType === 'about'
                      ? 'border-[#8B5CF6] bg-[#12121a] ring-1 ring-[#8B5CF6]/35'
                      : 'border-white/[0.12] hover:border-white/[0.15]'
                  }`}
                >
                  <h3 className="font-semibold text-white mb-1">About</h3>
                  <p className="text-sm text-white/75">Edit about page content</p>
                </button>
              </div>

              {legalPageType && (
                <form onSubmit={handleLegalPageSubmit} className="space-y-4">
                  <div>
                    <label className="block text-sm font-medium text-white/75 mb-1">
                      {legalPageType === 'privacy' && 'Privacy Statement'}
                      {legalPageType === 'terms' && 'Terms of Use'}
                      {legalPageType === 'cookies' && 'Cookie Statement'}
                      {legalPageType === 'event_requirements' && 'Event Requirements'}
                      {legalPageType === 'about' && 'About'}
                    </label>
                    <div className="border border-white/[0.15] rounded-lg overflow-hidden">
                      <ReactQuill
                        ref={legalQuillRef}
                        key={legalPageType ?? 'none'}
                        theme="snow"
                        value={legalPageContent}
                        onChange={setLegalPageContent}
                        modules={legalQuillModules}
                        className="bg-[#0B0B0D]"
                        style={{ minHeight: '400px' }}
                      />
                    </div>
                    {legalPageType === 'about' && (
                      <p className="mt-2 text-xs text-white/50">
                        About: use the image button to upload (stored in your media bucket). After upload, set width,
                        text wrap (own row vs float so text flows beside the image), alignment for block images, tight
                        spacing, and alt text. Put the cursor where you want the image; type paragraphs after the image
                        for wrap mode. Save when you are done.
                      </p>
                    )}
                    {legalPageType === 'about' && uploadingAboutImage && (
                      <p className="mt-1 text-sm text-white/60" aria-live="polite">
                        Uploading image…
                      </p>
                    )}
                  </div>
                  <div className="flex gap-2 pt-4">
                    <button
                      type="submit"
                      disabled={updateLegalPageMutation.isPending}
                      className="btn-haus-fill px-6 py-2 rounded-lg disabled:opacity-50"
                    >
                      {updateLegalPageMutation.isPending ? 'Updating...' : 'Update Page'}
                    </button>
                    <button
                      type="button"
                      onClick={() => {
                        setAboutImageLayoutOpen(null)
                        setLegalPageType(null)
                        setLegalPageContent('')
                      }}
                      className="btn-haus-outline px-6 py-2 rounded-lg"
                    >
                      Cancel
                    </button>
                  </div>
                </form>
              )}

              {aboutImageLayoutOpen && (
                <div
                  className="fixed inset-0 z-[200] flex items-center justify-center p-4 bg-black/70"
                  role="dialog"
                  aria-modal="true"
                  aria-labelledby="about-image-layout-title"
                  onClick={() => setAboutImageLayoutOpen(null)}
                >
                  <div
                    className="w-full max-w-lg rounded-xl border border-white/[0.15] bg-[#0B0B0D] p-5 shadow-xl"
                    onClick={(e) => e.stopPropagation()}
                  >
                    <h3 id="about-image-layout-title" className="text-lg font-semibold text-white">
                      Image layout
                    </h3>
                    <p className="mt-1 text-xs text-white/50">
                      These settings control how the image appears on the public About page.
                    </p>
                    <div className="mt-4 flex justify-center rounded-lg border border-white/[0.1] bg-[#070707] p-3">
                      <img
                        src={aboutImageLayoutOpen.url}
                        alt=""
                        className="max-h-40 max-w-full rounded-md object-contain"
                      />
                    </div>
                    <div className="mt-4 space-y-3">
                      <div>
                        <label className="block text-xs font-medium text-white/75 mb-1">Description (alt text) *</label>
                        <input
                          type="text"
                          value={aboutImageLayoutOpen.alt}
                          onChange={(e) =>
                            setAboutImageLayoutOpen((prev) =>
                              prev ? { ...prev, alt: e.target.value } : prev
                            )
                          }
                          className="w-full rounded-lg border border-white/[0.15] bg-[#070707] px-3 py-2 text-sm text-white"
                        />
                      </div>
                      <div>
                        <label className="block text-xs font-medium text-white/75 mb-1">Text around image</label>
                        <select
                          value={aboutImageLayoutOpen.wrap}
                          onChange={(e) => {
                            const wrap = e.target.value as AboutImageTextWrap
                            setAboutImageLayoutOpen((prev) => {
                              if (!prev) return prev
                              if (wrap !== 'block' && prev.width === 'full') {
                                return { ...prev, wrap, width: 'half' }
                              }
                              return { ...prev, wrap }
                            })
                          }}
                          className="w-full rounded-lg border border-white/[0.15] bg-[#070707] px-3 py-2 text-sm text-white"
                        >
                          <option value="block">Own row (no wrap)</option>
                          <option value="float-left">Wrap- image left, text on the right</option>
                          <option value="float-right">Wrap- image right, text on the left</option>
                        </select>
                        <p className="mt-1 text-[11px] text-white/45 leading-snug">
                          Wrap uses a float: place the image, then add paragraphs; they flow beside the image. Use less
                          than full width (full width always stays on its own row).
                        </p>
                      </div>
                      <div className="grid gap-3 sm:grid-cols-2">
                        <div>
                          <label className="block text-xs font-medium text-white/75 mb-1">Width</label>
                          <select
                            value={aboutImageLayoutOpen.width}
                            onChange={(e) => {
                              const width = e.target.value as AboutImageLayoutWidth
                              setAboutImageLayoutOpen((prev) => {
                                if (!prev) return prev
                                if (width === 'full' && prev.wrap !== 'block') {
                                  return { ...prev, width, wrap: 'block' }
                                }
                                return { ...prev, width }
                              })
                            }}
                            className="w-full rounded-lg border border-white/[0.15] bg-[#070707] px-3 py-2 text-sm text-white"
                          >
                            <option value="full">Full (100%)</option>
                            <option value="w75">Large (75%)</option>
                            <option value="half">Half (50%)</option>
                            <option value="third">Third (~33%)</option>
                            <option value="quarter">Quarter (25%)</option>
                          </select>
                        </div>
                        <div>
                          <label className="block text-xs font-medium text-white/75 mb-1">
                            Alignment{' '}
                            {aboutImageLayoutOpen.wrap !== 'block' ? (
                              <span className="font-normal text-white/40">(block images only)</span>
                            ) : null}
                          </label>
                          <select
                            value={aboutImageLayoutOpen.align}
                            disabled={aboutImageLayoutOpen.wrap !== 'block'}
                            onChange={(e) =>
                              setAboutImageLayoutOpen((prev) =>
                                prev
                                  ? { ...prev, align: e.target.value as AboutImageLayoutAlign }
                                  : prev
                              )
                            }
                            className="w-full rounded-lg border border-white/[0.15] bg-[#070707] px-3 py-2 text-sm text-white disabled:cursor-not-allowed disabled:opacity-40"
                          >
                            <option value="left">Left</option>
                            <option value="center">Center</option>
                            <option value="right">Right</option>
                          </select>
                        </div>
                      </div>
                      <label className="flex cursor-pointer items-center gap-2 text-sm text-white/85">
                        <input
                          type="checkbox"
                          checked={aboutImageLayoutOpen.tight}
                          onChange={(e) =>
                            setAboutImageLayoutOpen((prev) =>
                              prev ? { ...prev, tight: e.target.checked } : prev
                            )
                          }
                          className="rounded border-white/[0.2]"
                        />
                        Tight vertical spacing (less margin above and below)
                      </label>
                    </div>
                    <div className="mt-6 flex flex-wrap justify-end gap-2">
                      <button
                        type="button"
                        onClick={() => setAboutImageLayoutOpen(null)}
                        className="btn-haus-outline rounded-lg px-4 py-2 text-sm"
                      >
                        Cancel
                      </button>
                      <button
                        type="button"
                        onClick={confirmAboutImageLayout}
                        className="btn-haus-fill rounded-lg px-4 py-2 text-sm"
                      >
                        Insert image
                      </button>
                    </div>
                  </div>
                </div>
              )}
            </div>
          )}

          {contentManagementTab === 'carousel' && (
            <div className="space-y-6">
              {showCarouselForm ? (
                <div className="bg-[#0B0B0D] rounded-xl shadow-sm p-6 border border-white/[0.12]">
                  <h2 className="text-2xl font-semibold text-white mb-6">
                    {editingCarouselItem ? 'Edit Carousel Item' : 'Create Carousel Item'}
                  </h2>
                  <form onSubmit={handleCarouselSubmit} className="space-y-4">
                    <div>
                      <label className="block text-sm font-medium text-white/75 mb-1">Image or Video *</label>
                      <input
                        type="file"
                        accept="image/*,video/*"
                        onChange={handleImageFileChange}
                        className="w-full px-4 py-2 border border-white/[0.15] rounded-lg focus:ring-2 focus:ring-primary"
                        required={!editingCarouselItem}
                      />
                      <p className="text-xs text-white/50 mt-1">
                        Supported: Images (JPG, PNG, GIF, WebP) and Videos (MP4, WebM, MOV). Upload to the public
                        Yauga storage bucket.
                      </p>
                      {carouselImagePreview && (
                        <div className="mt-4">
                          {carouselImageFile && isVideoFile(carouselImageFile) ? (
                            <video
                              src={carouselImagePreview}
                              controls
                              className="max-w-full h-48 object-cover rounded-lg border border-white/[0.15]"
                            />
                          ) : (
                            <img
                              src={carouselImagePreview}
                              alt="Preview"
                              className="max-w-full h-48 object-cover rounded-lg border border-white/[0.15]"
                            />
                          )}
                        </div>
                      )}
                      {uploadingImage && (
                        <p className="text-sm text-white/50 mt-2">Uploading media...</p>
                      )}
                    </div>
                    <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
                      <div>
                        <label className="block text-sm font-medium text-white/75 mb-1">Placement *</label>
                        <select
                          value={carouselFormData.placement}
                          onChange={(e) =>
                            setCarouselFormData({
                              ...carouselFormData,
                              placement: (['homepage', 'join_us', 'ritual_room', 'run_club', 'yauga_haus'].includes(
                                e.target.value
                              )
                                ? e.target.value
                                : 'homepage') as CarouselPlacement,
                            })
                          }
                          className="w-full px-4 py-2 border border-white/[0.15] rounded-lg focus:ring-2 focus:ring-primary bg-[#0B0B0D] text-white"
                        >
                          <option value="homepage">Homepage</option>
                          <option value="join_us">Join Us (/join-us)</option>
                          <option value="ritual_room">Ritual Rooms</option>
                          <option value="run_club">Run Club</option>
                          <option value="yauga_haus">Yauga Haus</option>
                        </select>
                        <p className="text-xs text-white/50 mt-1">
                          Homepage slides appear on the home hero. Join Us slides appear only on /join-us.
                        </p>
                      </div>
                      <div>
                        <label className="block text-sm font-medium text-white/75 mb-1">Orientation *</label>
                        <select
                          value={carouselFormData.orientation}
                          onChange={(e) =>
                            setCarouselFormData({
                              ...carouselFormData,
                              orientation: e.target.value === 'portrait' ? 'portrait' : 'landscape',
                            })
                          }
                          className="w-full px-4 py-2 border border-white/[0.15] rounded-lg focus:ring-2 focus:ring-primary bg-[#0B0B0D] text-white"
                        >
                          <option value="landscape">Landscape</option>
                          <option value="portrait">Portrait</option>
                        </select>
                        <p className="text-xs text-white/50 mt-1">
                          Portrait Join Us: video on the left, Find my city on the right (stacks on mobile).
                        </p>
                      </div>
                    </div>
                    <div>
                      <label className="block text-sm font-medium text-white/75 mb-1">Headline (hero text) *</label>
                      <input
                        type="text"
                        value={carouselFormData.headline}
                        onChange={(e) => setCarouselFormData({ ...carouselFormData, headline: e.target.value })}
                        className="w-full px-4 py-2 border border-white/[0.15] rounded-lg focus:ring-2 focus:ring-primary"
                        required
                      />
                    </div>
                    <div className="rounded-lg border border-white/[0.12] bg-[#070707] p-4 space-y-3">
                      <p className="text-sm font-medium text-white/85">Hero buttons</p>
                      <p className="text-xs text-white/50">
                        These come from the carousel table: each active slide can have its own primary and optional
                        secondary button. Both label and URL are required for a button to show (e.g. path{' '}
                        <code className="rounded bg-white/[0.06] px-1 text-white/65">/events</code> or{' '}
                        <code className="rounded bg-white/[0.06] px-1 text-white/65">/#city-vote</code>, or an https
                        URL). Homepage and Join Us slides both use these fields.
                      </p>
                      <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                        <div>
                          <label className="block text-xs font-medium text-white/65 mb-1">Primary button label</label>
                          <input
                            type="text"
                            value={carouselFormData.cta1_label}
                            onChange={(e) => setCarouselFormData({ ...carouselFormData, cta1_label: e.target.value })}
                            className="w-full px-3 py-2 border border-white/[0.15] rounded-lg focus:ring-2 focus:ring-primary text-sm"
                            placeholder="e.g. Explore events"
                          />
                        </div>
                        <div>
                          <label className="block text-xs font-medium text-white/65 mb-1">Primary URL</label>
                          <input
                            type="text"
                            value={carouselFormData.cta1_url}
                            onChange={(e) => setCarouselFormData({ ...carouselFormData, cta1_url: e.target.value })}
                            className="w-full px-3 py-2 border border-white/[0.15] rounded-lg focus:ring-2 focus:ring-primary text-sm font-mono"
                            placeholder="/events or https://…"
                          />
                        </div>
                        <div>
                          <label className="block text-xs font-medium text-white/65 mb-1">Secondary button label</label>
                          <input
                            type="text"
                            value={carouselFormData.cta2_label}
                            onChange={(e) => setCarouselFormData({ ...carouselFormData, cta2_label: e.target.value })}
                            className="w-full px-3 py-2 border border-white/[0.15] rounded-lg focus:ring-2 focus:ring-primary text-sm"
                            placeholder="Optional"
                          />
                        </div>
                        <div>
                          <label className="block text-xs font-medium text-white/65 mb-1">Secondary URL</label>
                          <input
                            type="text"
                            value={carouselFormData.cta2_url}
                            onChange={(e) => setCarouselFormData({ ...carouselFormData, cta2_url: e.target.value })}
                            className="w-full px-3 py-2 border border-white/[0.15] rounded-lg focus:ring-2 focus:ring-primary text-sm font-mono"
                            placeholder="/about or https://…"
                          />
                        </div>
                      </div>
                    </div>
                    <div>
                      <label className="block text-sm font-medium text-white/75 mb-1">Description (Alt Text) *</label>
                      <input
                        type="text"
                        value={carouselFormData.description}
                        onChange={(e) => setCarouselFormData({ ...carouselFormData, description: e.target.value })}
                        className="w-full px-4 py-2 border border-white/[0.15] rounded-lg focus:ring-2 focus:ring-primary"
                        required
                      />
                    </div>
                    <div>
                      <label className="block text-sm font-medium text-white/75 mb-1">Title *</label>
                      <input
                        type="text"
                        value={carouselFormData.title}
                        onChange={(e) => setCarouselFormData({ ...carouselFormData, title: e.target.value })}
                        className="w-full px-4 py-2 border border-white/[0.15] rounded-lg focus:ring-2 focus:ring-primary"
                        required
                      />
                    </div>
                    <div>
                      <label className="block text-sm font-medium text-white/75 mb-1">
                        Article{carouselFormData.placement === 'join_us' ? '' : ' *'}
                      </label>
                      <p className="text-xs text-white/50 mb-2">
                        {carouselFormData.placement === 'join_us'
                          ? 'Optional for Join Us slides. Visitors see the video and city finder, not this article. '
                          : ''}
                        To embed the &quot;vote for your city&quot; form, add this shortcode on its own line (works in the rich text editor):{' '}
                        <code className="bg-white/[0.08] px-1 rounded">[city_vote]</code>
                        . If you paste raw HTML, Quill may show it as text instead-use the shortcode instead.
                      </p>
                      <div className="border border-white/[0.15] rounded-lg overflow-hidden">
                        <ReactQuill
                          theme="snow"
                          value={carouselFormData.article}
                          onChange={(value) => setCarouselFormData({ ...carouselFormData, article: value })}
                          modules={{
                            toolbar: [
                              [{ 'header': [1, 2, 3, false] }],
                              ['bold', 'italic', 'underline', 'strike'],
                              [{ 'list': 'ordered'}, { 'list': 'bullet' }],
                              [{ 'color': [] }, { 'background': [] }],
                              ['link'],
                              ['clean']
                            ],
                          }}
                          className="bg-[#0B0B0D]"
                          style={{ minHeight: '200px' }}
                        />
                      </div>
                    </div>
                    <div>
                      <label className="block text-sm font-medium text-white/75 mb-1">SEO Title</label>
                      <input
                        type="text"
                        value={carouselFormData.seo_title}
                        onChange={(e) => setCarouselFormData({ ...carouselFormData, seo_title: e.target.value })}
                        className="w-full px-4 py-2 border border-white/[0.15] rounded-lg focus:ring-2 focus:ring-primary"
                        placeholder="Optional: custom page title for search engines"
                      />
                    </div>
                    <div>
                      <label className="block text-sm font-medium text-white/75 mb-1">SEO Description</label>
                      <textarea
                        value={carouselFormData.seo_description}
                        onChange={(e) => setCarouselFormData({ ...carouselFormData, seo_description: e.target.value })}
                        className="w-full px-4 py-2 border border-white/[0.15] rounded-lg focus:ring-2 focus:ring-primary"
                        rows={3}
                        placeholder="Optional: meta description for this article page"
                      />
                    </div>
                    <div>
                      <label className="block text-sm font-medium text-white/75 mb-1">SEO Keywords</label>
                      <input
                        type="text"
                        value={carouselFormData.seo_keywords}
                        onChange={(e) => setCarouselFormData({ ...carouselFormData, seo_keywords: e.target.value })}
                        className="w-full px-4 py-2 border border-white/[0.15] rounded-lg focus:ring-2 focus:ring-primary"
                        placeholder="keyword 1, keyword 2, keyword 3"
                      />
                    </div>
                    <div>
                      <label className="block text-sm font-medium text-white/75 mb-1">SEO Slug</label>
                      <input
                        type="text"
                        value={carouselFormData.seo_slug}
                        onChange={(e) => setCarouselFormData({ ...carouselFormData, seo_slug: e.target.value })}
                        className="w-full px-4 py-2 border border-white/[0.15] rounded-lg focus:ring-2 focus:ring-primary"
                        placeholder="optional-custom-article-slug"
                      />
                    </div>
                    <div className="grid grid-cols-2 gap-4">
                      <div>
                        <label className="block text-sm font-medium text-white/75 mb-1">Display Order</label>
                        <input
                          type="number"
                          value={carouselFormData.display_order}
                          onChange={(e) => setCarouselFormData({ ...carouselFormData, display_order: Number(e.target.value) })}
                          className="w-full px-4 py-2 border border-white/[0.15] rounded-lg focus:ring-2 focus:ring-primary"
                          min="0"
                        />
                      </div>
                      <div className="flex items-center pt-8">
                        <label className="flex items-center">
                          <input
                            type="checkbox"
                            checked={carouselFormData.is_active}
                            onChange={(e) => setCarouselFormData({ ...carouselFormData, is_active: e.target.checked })}
                            className="mr-2"
                          />
                          <span className="text-sm font-medium text-white/75">Active</span>
                        </label>
                      </div>
                    </div>
                    <div className="flex gap-4">
                      <button
                        type="submit"
                        disabled={uploadingImage}
                        className="btn-haus-fill px-6 py-2 rounded-lg disabled:opacity-50 disabled:cursor-not-allowed"
                      >
                        {uploadingImage ? 'Uploading...' : editingCarouselItem ? 'Update' : 'Create'}
                      </button>
                      <button
                        type="button"
                        onClick={handleCarouselCancel}
                        className="btn-haus-outline px-6 py-2 rounded-lg"
                      >
                        Cancel
                      </button>
                    </div>
                  </form>
                </div>
              ) : (
                <div className="bg-[#0B0B0D] rounded-xl shadow-sm p-6 border border-white/[0.12]">
                  <h2 className="text-2xl font-semibold text-white mb-1">Carousel Items</h2>
                  <p className="text-sm text-white/50 mb-4">
                    Homepage slides feed the home hero. Join Us slides feed /join-us (usually one video). Manage
                    WhatsApp cities under the WhatsApp tab.
                  </p>
                  {carouselItems.length === 0 ? (
                    <p className="text-white/50 text-center py-8">No carousel items yet. Create your first one!</p>
                  ) : (
                    <div className="space-y-4">
                      {carouselItems.map((item) => (
                        <div key={item.id} className="border border-white/[0.12] rounded-lg p-4 flex items-center justify-between">
                          <div className="flex items-center gap-4 flex-1">
                            <div className="relative w-40 h-28 flex-shrink-0">
                              {isVideoUrl(item.image_url) ? (
                                <>
                                  <video
                                    src={item.image_url}
                                    muted
                                    playsInline
                                    loop
                                    autoPlay
                                    preload="metadata"
                                    className="w-full h-full object-cover rounded border border-white/[0.12]"
                                  />
                                  <div className="absolute inset-0 flex items-center justify-center pointer-events-none">
                                    <div className="bg-black/40 rounded-full p-2">
                                      <svg className="w-5 h-5 text-white" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
                                        <path d="M8 5v14l11-7z" />
                                      </svg>
                                    </div>
                                  </div>
                                </>
                              ) : (
                                <img
                                  src={item.image_url}
                                  alt={item.description}
                                  className="w-full h-full object-cover rounded border border-white/[0.12]"
                                />
                              )}
                            </div>
                            <div className="flex-1">
                              <h3 className="font-semibold text-white">{item.headline}</h3>
                              <p className="text-sm text-white/65">{item.title}</p>
                              <div className="flex gap-4 mt-2 text-sm text-white/50">
                                <span>Order: {item.display_order}</span>
                                <span className="text-[#A78BFA]">
                                  {item.placement === 'join_us'
                                    ? 'Join Us'
                                    : item.placement === 'ritual_room'
                                      ? 'Ritual Rooms'
                                      : item.placement === 'run_club'
                                        ? 'Run Club'
                                        : item.placement === 'yauga_haus'
                                          ? 'Yauga Haus'
                                          : 'Homepage'}
                                  {' · '}
                                  {item.orientation === 'portrait' ? 'Portrait' : 'Landscape'}
                                </span>
                                <span className={item.is_active ? 'text-green-600' : 'text-red-600'}>
                                  {item.is_active ? 'Active' : 'Inactive'}
                                </span>
                              </div>
                            </div>
                          </div>
                          <div className="flex gap-2">
                            <button
                              onClick={() => handleCarouselEdit(item)}
                              className="btn-haus-fill rounded-lg px-4 py-2 text-sm"
                            >
                              Edit
                            </button>
                            <button
                              onClick={() => {
                                setConfirmModal({
                                  show: true,
                                  title: 'Delete Carousel Item',
                                  message: 'Are you sure you want to delete this carousel item?',
                                  confirmText: 'Delete',
                                  cancelText: 'Cancel',
                                  confirmButtonClass: 'bg-red-500 hover:bg-red-600',
                                  onConfirm: () => {
                                    deleteCarouselItemMutation.mutate(item.id)
                                    setConfirmModal(null)
                                  },
                                })
                              }}
                              className="bg-red-500 text-white px-4 py-2 rounded-lg text-sm hover:bg-red-600"
                            >
                              Delete
                            </button>
                          </div>
                        </div>
                      ))}
                    </div>
                  )}
                </div>
              )}
            </div>
          )}

          {contentManagementTab === 'faq' && (
            <div className="space-y-6">
              {showFAQForm ? (
                <div className="bg-[#0B0B0D] rounded-xl shadow-sm p-6 border border-white/[0.12]">
                  <h2 className="text-2xl font-semibold text-white mb-6">
                    {editingFAQ ? 'Edit FAQ' : 'Create FAQ'}
                  </h2>
                  <form onSubmit={handleFAQSubmit} className="space-y-4">
                    <div>
                      <label className="block text-sm font-medium text-white/75 mb-1">Question *</label>
                      <input
                        type="text"
                        value={faqFormData.question}
                        onChange={(e) => setFAQFormData({ ...faqFormData, question: e.target.value })}
                        className="w-full px-4 py-2 border border-white/[0.15] rounded-lg focus:ring-2 focus:ring-primary"
                        required
                      />
                    </div>
                    <div>
                      <label className="block text-sm font-medium text-white/75 mb-1">Answer *</label>
                      <textarea
                        value={faqFormData.answer}
                        onChange={(e) => setFAQFormData({ ...faqFormData, answer: e.target.value })}
                        className="w-full px-4 py-2 border border-white/[0.15] rounded-lg focus:ring-2 focus:ring-primary"
                        rows={8}
                        required
                      />
                    </div>
                    <div className="grid grid-cols-2 gap-4">
                      <div>
                        <label className="block text-sm font-medium text-white/75 mb-1">Display Order</label>
                        <input
                          type="number"
                          value={faqFormData.display_order}
                          onChange={(e) => setFAQFormData({ ...faqFormData, display_order: Number(e.target.value) })}
                          className="w-full px-4 py-2 border border-white/[0.15] rounded-lg focus:ring-2 focus:ring-primary"
                          min="0"
                        />
                      </div>
                      <div className="flex items-center pt-8">
                        <label className="flex items-center">
                          <input
                            type="checkbox"
                            checked={faqFormData.is_active}
                            onChange={(e) => setFAQFormData({ ...faqFormData, is_active: e.target.checked })}
                            className="mr-2"
                          />
                          <span className="text-sm font-medium text-white/75">Active</span>
                        </label>
                      </div>
                    </div>
                    <div className="flex gap-4">
                      <button
                        type="submit"
                        disabled={createFAQMutation.isPending || updateFAQMutation.isPending}
                        className="btn-haus-fill px-6 py-2 rounded-lg disabled:opacity-50 disabled:cursor-not-allowed"
                      >
                        {createFAQMutation.isPending || updateFAQMutation.isPending
                          ? (editingFAQ ? 'Updating...' : 'Creating...')
                          : (editingFAQ ? 'Update' : 'Create')}
                      </button>
                      <button
                        type="button"
                        onClick={handleFAQCancel}
                        className="btn-haus-outline px-6 py-2 rounded-lg"
                      >
                        Cancel
                      </button>
                    </div>
                  </form>
                </div>
              ) : (
                <div className="bg-[#0B0B0D] rounded-xl shadow-sm p-6 border border-white/[0.12]">
                  <div className="flex justify-between items-center mb-4">
                    <h2 className="text-2xl font-semibold text-white">FAQs</h2>
                    <button
                      onClick={() => {
                        setEditingFAQ(null)
                        setFAQFormData({
                          question: '',
                          answer: '',
                          display_order: faqs.length > 0 ? Math.max(...faqs.map(f => f.display_order)) + 1 : 0,
                          is_active: true,
                        })
                        setShowFAQForm(true)
                      }}
                      className="btn-haus-fill rounded-lg px-4 py-2 text-sm transition-colors"
                    >
                      Add FAQ
                    </button>
                  </div>
                  {faqs.length === 0 ? (
                    <p className="text-white/50 text-center py-8">No FAQs yet. Create your first one!</p>
                  ) : (
                    <div className="space-y-4">
                      {faqs.map((faq) => (
                        <div key={faq.id} className="border border-white/[0.12] rounded-lg p-4 flex items-start justify-between">
                          <div className="flex-1">
                            <h3 className="font-semibold text-white mb-2">{faq.question}</h3>
                            <p className="text-sm text-white/65 line-clamp-2">{faq.answer}</p>
                            <div className="flex gap-4 mt-2 text-sm text-white/50">
                              <span>Order: {faq.display_order}</span>
                              <span className={faq.is_active ? 'text-green-600' : 'text-red-600'}>
                                {faq.is_active ? 'Active' : 'Inactive'}
                              </span>
                            </div>
                          </div>
                          <div className="flex gap-2 ml-4">
                            <button
                              onClick={() => handleFAQEdit(faq)}
                              className="btn-haus-fill rounded-lg px-4 py-2 text-sm"
                            >
                              Edit
                            </button>
                            <button
                              onClick={() => {
                                setConfirmModal({
                                  show: true,
                                  title: 'Delete FAQ',
                                  message: 'Are you sure you want to delete this FAQ?',
                                  confirmText: 'Delete',
                                  cancelText: 'Cancel',
                                  confirmButtonClass: 'bg-red-500 hover:bg-red-600',
                                  onConfirm: () => {
                                    deleteFAQMutation.mutate(faq.id)
                                    setConfirmModal(null)
                                  },
                                })
                              }}
                              className="bg-red-500 text-white px-4 py-2 rounded-lg text-sm hover:bg-red-600"
                            >
                              Delete
                            </button>
                          </div>
                        </div>
                      ))}
                    </div>
                  )}
                </div>
              )}
            </div>
          )}

          {contentManagementTab === 'checklist' && (
            <div className="space-y-6">
              <div className="flex justify-between items-center">
                <h2 className="text-2xl font-bold text-white">Event Checklist Items</h2>
                <button
                  onClick={() => {
                    setEditingChecklistItem(null)
                    setChecklistItemFormData({ item_text: '', display_order: checklistItems.length })
                    setShowChecklistItemForm(true)
                  }}
                  className="btn-haus-fill rounded-lg px-4 py-2"
                >
                  Add Checklist Item
                </button>
              </div>

              {checklistItems.length === 0 ? (
                <div className="text-center py-12 text-white/50 bg-[#0B0B0D] rounded-xl border border-white/[0.12]">
                  No checklist items yet. Add your first item to get started.
                </div>
              ) : (
                <div className="bg-[#0B0B0D] rounded-xl shadow-sm border border-white/[0.12] overflow-hidden">
                  <table className="min-w-full divide-y divide-white/[0.12]">
                    <thead className="bg-[#070707]">
                      <tr>
                        <th className="px-6 py-3 text-left text-xs font-medium text-white/50 uppercase tracking-wider">Order</th>
                        <th className="px-6 py-3 text-left text-xs font-medium text-white/50 uppercase tracking-wider">Item</th>
                        <th className="px-6 py-3 text-right text-xs font-medium text-white/50 uppercase tracking-wider">Actions</th>
                      </tr>
                    </thead>
                    <tbody className="bg-[#0B0B0D] divide-y divide-white/[0.12]">
                      {checklistItems.map((item: EventChecklistItem) => (
                        <tr key={item.id}>
                          <td className="px-6 py-4 whitespace-nowrap text-sm text-white">{item.display_order}</td>
                          <td className="px-6 py-4 text-sm text-white">{item.item_text}</td>
                          <td className="px-6 py-4 whitespace-nowrap text-right text-sm font-medium space-x-2">
                            <button
                              onClick={() => {
                                setEditingChecklistItem(item)
                                setChecklistItemFormData({ item_text: item.item_text, display_order: item.display_order })
                                setShowChecklistItemForm(true)
                              }}
                              className="text-blue-600 hover:text-blue-900"
                            >
                              Edit
                            </button>
                            <button
                              onClick={async () => {
                                setConfirmModal({
                                  show: true,
                                  title: 'Delete Checklist Item',
                                  message: `Are you sure you want to delete "${item.item_text}"?`,
                                  confirmText: 'Delete',
                                  cancelText: 'Cancel',
                                  confirmButtonClass: 'bg-red-500 hover:bg-red-600',
                                  onConfirm: async () => {
                                    try {
                                      await checklistApi.deleteItem(item.id)
                                      queryClient.invalidateQueries({ queryKey: ['checklist-items'] })
                                      toast.success('Checklist item deleted successfully!')
                                      setConfirmModal(null)
                                    } catch (error: any) {
                                      toast.error(`Failed to delete item: ${error.message || 'Unknown error'}`)
                                      setConfirmModal(null)
                                    }
                                  },
                                })
                              }}
                              className="text-red-600 hover:text-red-900"
                            >
                              Delete
                            </button>
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}

              {/* Checklist Item Form Modal */}
              {showChecklistItemForm && (
                <div className="fixed inset-0 z-50 flex items-center justify-center bg-black bg-opacity-50 p-4">
                  <div className="bg-[#0B0B0D] rounded-xl shadow-xl max-w-md w-full">
                    <div className="p-6">
                      <div className="flex justify-between items-center mb-4">
                        <h2 className="text-2xl font-bold text-white">
                          {editingChecklistItem ? 'Edit Checklist Item' : 'Add Checklist Item'}
                        </h2>
                        <button
                          onClick={() => {
                            setShowChecklistItemForm(false)
                            setEditingChecklistItem(null)
                          }}
                          className="text-white/40 hover:text-white/65"
                        >
                          <svg className="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                          </svg>
                        </button>
                      </div>
                      <form onSubmit={async (e) => {
                        e.preventDefault()
                        try {
                          if (editingChecklistItem) {
                            await checklistApi.updateItem(editingChecklistItem.id, checklistItemFormData)
                            toast.success('Checklist item updated successfully!')
                          } else {
                            await checklistApi.createItem(checklistItemFormData)
                            toast.success('Checklist item added successfully!')
                          }
                          queryClient.invalidateQueries({ queryKey: ['checklist-items'] })
                          setShowChecklistItemForm(false)
                          setEditingChecklistItem(null)
                          setChecklistItemFormData({ item_text: '', display_order: 0 })
                        } catch (error: any) {
                          toast.error(`Failed to save item: ${error.message || 'Unknown error'}`)
                        }
                      }} className="space-y-4">
                        <div>
                          <label className="block text-sm font-medium text-white/75 mb-1">Item Text *</label>
                          <input
                            type="text"
                            value={checklistItemFormData.item_text}
                            onChange={(e) => setChecklistItemFormData({ ...checklistItemFormData, item_text: e.target.value })}
                            className="w-full px-4 py-2 border border-white/[0.15] rounded-lg focus:ring-2 focus:ring-primary focus:border-transparent"
                            placeholder="e.g., Confirm venue booking"
                            required
                          />
                        </div>
                        <div>
                          <label className="block text-sm font-medium text-white/75 mb-1">Display Order</label>
                          <input
                            type="number"
                            value={checklistItemFormData.display_order}
                            onChange={(e) => setChecklistItemFormData({ ...checklistItemFormData, display_order: parseInt(e.target.value) || 0 })}
                            className="w-full px-4 py-2 border border-white/[0.15] rounded-lg focus:ring-2 focus:ring-primary focus:border-transparent"
                            min="0"
                          />
                        </div>
                        <div className="flex gap-3">
                          <button
                            type="submit"
                            className="btn-haus-fill flex-1 rounded-lg px-6 py-3"
                          >
                            {editingChecklistItem ? 'Update' : 'Add'} Item
                          </button>
                          <button
                            type="button"
                            onClick={() => {
                              setShowChecklistItemForm(false)
                              setEditingChecklistItem(null)
                            }}
                            className="btn-haus-outline flex-1 rounded-lg px-6 py-3"
                          >
                            Cancel
                          </button>
                        </div>
                      </form>
                    </div>
                  </div>
                </div>
              )}
            </div>
          )}

          {contentManagementTab === 'location-library' && (
            <div className="space-y-6">
              <div>
                <h2 className="text-2xl font-bold text-white">Image Library</h2>
                <p className="text-sm text-white/60 mt-1 max-w-2xl">
                  Reusable images (e.g. city scenes). Events can reference these or add new uploads (which are stored here
                  automatically). You cannot remove an image that is still linked from an event- detach it from the event
                  first.
                </p>
              </div>
              <AdminLocationLibraryPanel />
            </div>
          )}

          {contentManagementTab === 'hosts' && (
            <div className="space-y-6">
              <div>
                <h2 className="text-2xl font-bold text-white">Hosts</h2>
                <p className="text-sm text-white/60 mt-1 max-w-2xl">
                  Reusable hosts with a name and photo. Attach one when creating or editing an event so the detail page
                  shows “Hosted by …” without re-entering the same person.
                </p>
              </div>
              <AdminEventHostsPanel />
            </div>
          )}

          {contentManagementTab === 'rings' && (
            <div className="space-y-6">
              <div>
                <h2 className="text-2xl font-bold text-white">Yauga Rings</h2>
                <p className="text-sm text-white/60 mt-1 max-w-2xl">
                  Issue a ring id and NFC UID before a member can register that ring. Rings already registered are listed here automatically.
                </p>
              </div>
              <AdminRingInventoryPanel />
            </div>
          )}

          {contentManagementTab === 'partners' && (
            <div className="space-y-6">
              <div>
                <h2 className="text-2xl font-bold text-white">Partner logos</h2>
                <p className="mt-1 max-w-2xl text-sm text-white/60">
                  Manage partner logos for the homepage carousel above the footer. Each logo links to the partner website
                  in a new tab.
                </p>
              </div>
              <AdminPartnerLogosPanel />
            </div>
          )}

          {contentManagementTab === 'whatsapp' && (
            <div className="bg-[#0B0B0D] rounded-xl shadow-sm p-6 border border-white/[0.12]">
              <div className="mb-4">
                <h2 className="text-2xl font-semibold text-white">WhatsApp</h2>
                <p className="text-sm text-white/65 mt-1">Manage local WhatsApp groups and links shown to users.</p>
              </div>
              <WhatsAppGroupsManagement enabled />
            </div>
          )}

          {contentManagementTab === 'nda' && <AdminNdaPanel />}
          {contentManagementTab === 'contracts' && <AdminContractsPanel />}
          {contentManagementTab === 'meditation' && (
            <div className="bg-[#0B0B0D] rounded-xl shadow-sm p-6 border border-white/[0.12]">
              <AdminMeditationPanel />
            </div>
          )}
        </div>
      )}

      {activeTab === 'loyalty' && (
        <div id="panel-loyalty" role="tabpanel" aria-labelledby="tab-users" className="space-y-6">
          {renderUsersSubNav()}
          <div className="flex justify-between items-center">
            <h2 className="text-2xl font-semibold text-white">Loyalty Points Management</h2>
            <button
              onClick={() => {
                setShowAwardPointsForm(true)
                setAwardPointsForm({ userEmail: '', points: '', reason: '', awardToAll: false })
              }}
              className="btn-haus-fill px-6 py-2 rounded-lg"
            >
              Award Points
            </button>
          </div>

          {/* Award Points Form */}
          {showAwardPointsForm && (
            <div className="bg-[#0B0B0D] rounded-xl shadow-sm p-6 border border-white/[0.12]">
              <h3 className="text-xl font-semibold text-white mb-4">Award Points</h3>
              <form
                onSubmit={(e) => {
                  e.preventDefault()
                  if (!awardPointsForm.points || !awardPointsForm.reason) {
                    toast.error('Please fill in all required fields')
                    return
                  }
                  if (!awardPointsForm.awardToAll && !awardPointsForm.userEmail) {
                    toast.error('Please enter a user email or select "Award to all users"')
                    return
                  }
                  awardPointsMutation.mutate({
                    email: awardPointsForm.userEmail || null,
                    points: parseInt(awardPointsForm.points),
                    reason: awardPointsForm.reason,
                    awardToAll: awardPointsForm.awardToAll,
                  })
                }}
                className="space-y-4"
              >
                <div>
                  <label className="flex items-center gap-2 mb-2">
                    <input
                      type="checkbox"
                      checked={awardPointsForm.awardToAll}
                      onChange={(e) => setAwardPointsForm({ ...awardPointsForm, awardToAll: e.target.checked, userEmail: '' })}
                      className="rounded border-white/[0.15] text-primary focus:ring-primary"
                    />
                    <span className="text-sm font-medium text-white/75">Award to all users</span>
                  </label>
                </div>
                {!awardPointsForm.awardToAll && (
                  <div>
                    <label className="block text-sm font-medium text-white/75 mb-1">
                      User Email *
                    </label>
                    <select
                      value={awardPointsForm.userEmail}
                      onChange={(e) => setAwardPointsForm({ ...awardPointsForm, userEmail: e.target.value })}
                      className="w-full px-4 py-2 border border-white/[0.15] rounded-lg focus:ring-2 focus:ring-primary"
                      required={!awardPointsForm.awardToAll}
                    >
                      <option value="">Select a user...</option>
                      {usersWithPoints.map((user) => (
                        <option key={user.email} value={user.email}>
                          {user.name} - {user.email}
                        </option>
                      ))}
                    </select>
                  </div>
                )}
                <div>
                  <label className="block text-sm font-medium text-white/75 mb-1">
                    Points *
                  </label>
                  <input
                    type="number"
                    value={awardPointsForm.points}
                    onChange={(e) => setAwardPointsForm({ ...awardPointsForm, points: e.target.value })}
                    className="w-full px-4 py-2 border border-white/[0.15] rounded-lg focus:ring-2 focus:ring-primary"
                    placeholder="100"
                    min="1"
                    required
                  />
                </div>
                <div>
                  <label className="block text-sm font-medium text-white/75 mb-1">
                    Reason *
                  </label>
                  <input
                    type="text"
                    value={awardPointsForm.reason}
                    onChange={(e) => setAwardPointsForm({ ...awardPointsForm, reason: e.target.value })}
                    className="w-full px-4 py-2 border border-white/[0.15] rounded-lg focus:ring-2 focus:ring-primary"
                    placeholder="e.g., Special promotion, Referral bonus"
                    required
                  />
                </div>
                <div className="flex gap-2">
                  <button
                    type="submit"
                    disabled={awardPointsMutation.isPending}
                    className="btn-haus-fill px-6 py-2 rounded-lg disabled:opacity-50"
                  >
                    {awardPointsMutation.isPending ? 'Awarding...' : 'Award Points'}
                  </button>
                  <button
                    type="button"
                    onClick={() => {
                      setShowAwardPointsForm(false)
                      setAwardPointsForm({ userEmail: '', points: '', reason: '', awardToAll: false })
                    }}
                    className="btn-haus-outline px-6 py-2 rounded-lg"
                  >
                    Cancel
                  </button>
                </div>
              </form>
            </div>
          )}

          {/* Users with Points List */}
          <div className="bg-[#0B0B0D] rounded-xl shadow-sm p-6 border border-white/[0.12]">
            <h3 className="text-xl font-semibold text-white mb-4">Members by Points (Highest to Lowest)</h3>
            {usersWithPoints.length === 0 ? (
              <p className="text-white/50 text-center py-8">No users with points yet.</p>
            ) : (
              <div className="overflow-x-auto">
                <table className="min-w-full divide-y divide-white/[0.12]">
                  <thead className="bg-[#070707]">
                    <tr>
                      <th className="px-6 py-3 text-left text-xs font-medium text-white/50 uppercase tracking-wider">
                        Rank
                      </th>
                      <th className="px-6 py-3 text-left text-xs font-medium text-white/50 uppercase tracking-wider">
                        Name
                      </th>
                      <th className="px-6 py-3 text-left text-xs font-medium text-white/50 uppercase tracking-wider">
                        Email
                      </th>
                      <th className="px-6 py-3 text-left text-xs font-medium text-white/50 uppercase tracking-wider">
                        Total Points
                      </th>
                    </tr>
                  </thead>
                  <tbody className="bg-[#0B0B0D] divide-y divide-white/[0.12]">
                    {usersWithPoints.map((user, index) => (
                      <tr key={user.email}>
                        <td className="px-6 py-4 whitespace-nowrap text-sm font-medium text-white">
                          #{index + 1}
                        </td>
                        <td className="px-6 py-4 whitespace-nowrap text-sm text-white">
                          {user.name}
                        </td>
                        <td className="px-6 py-4 whitespace-nowrap text-sm text-white/50">
                          {user.email}
                        </td>
                        <td className="px-6 py-4 whitespace-nowrap text-sm font-semibold text-primary">
                          {user.points.toLocaleString()}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </div>
        </div>
      )}

      {activeTab === 'redemptions' && (
        <div id="panel-redemptions" role="tabpanel" aria-labelledby="tab-users" className="space-y-6">
          {renderUsersSubNav()}
          <div className="bg-[#0B0B0D] rounded-xl shadow-sm p-6 border border-white/[0.12]">
            <div className="mb-4">
              <h2 className="text-2xl font-semibold text-white">Redemptions Portal</h2>
              <p className="text-sm text-white/65 mt-1">Add items and manage redemption requests.</p>
            </div>
            <RedemptionsManagement />
          </div>
        </div>
      )}

      {activeTab === 'shop' && (
        <div id="panel-shop" role="tabpanel" aria-labelledby="tab-shop" className="space-y-6">
          <div className="bg-[#0B0B0D] rounded-xl shadow-sm p-6 border border-white/[0.12]">
            <div className="mb-4">
              <h2 className="text-2xl font-semibold text-white">Shop</h2>
              <p className="text-sm text-white/65 mt-1">Categories, products, shipping settings, and event upsells.</p>
            </div>
            <AdminShopManagement />
          </div>
        </div>
      )}

      {activeTab === 'orders' && (
        <div id="panel-orders" role="tabpanel" aria-labelledby="tab-orders" className="space-y-6">
          <div className="bg-[#0B0B0D] rounded-xl shadow-sm p-6 border border-white/[0.12]">
            <AdminOrdersPanel />
          </div>
        </div>
      )}

      {activeTab === 'discount-codes' && (
        <div id="panel-discount-codes" role="tabpanel" aria-labelledby="tab-discount-codes" className="space-y-6">
          <DiscountCodesManagement />
        </div>
      )}

      {/* Event Details Modal */}
      {showEventDetailsModal && selectedEventForDetails && managerRevenue && (
        <EventDetailsModal
          eventId={selectedEventForDetails}
          eventName={managerRevenue.events.find(e => e.event_id === selectedEventForDetails)?.event_name || 'Event'}
          onClose={() => {
            setShowEventDetailsModal(false)
            setSelectedEventForDetails(null)
          }}
        />
      )}

      {/* Month Details Modal */}
      {showMonthDetailsModal && selectedMonthForDetails && (
        <MonthDetailsModal
          monthKey={selectedMonthForDetails}
          onClose={() => {
            setShowMonthDetailsModal(false)
            setSelectedMonthForDetails(null)
          }}
        />
      )}

      {activeTab === 'settings' && (
        <div id="panel-settings" role="tabpanel" aria-labelledby="tab-settings" className="space-y-4">
          <h2 className="text-lg font-semibold text-white">Settings</h2>

          <div className="space-y-3">
            <AdminSettingsSection
              title="Brand"
              open={settingsBrandOpen}
              onToggle={() => setSettingsBrandOpen((v) => !v)}
            >
              <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                <div className="space-y-5">
                  <div>
                    <label htmlFor="brand_name" className="block font-medium text-white">Brand Name</label>
                    <p className="text-xs text-white/50 mt-0.5">Used for user-facing text and emails.</p>
                    <div className="mt-1.5 flex items-center gap-2">
                      <input
                        id="brand_name"
                        type="text"
                        value={brandNameInput}
                        onChange={(e) => setBrandNameInput(e.target.value)}
                        className="flex-1 min-w-0 px-3 py-2 text-sm border border-white/[0.15] rounded-lg focus:ring-2 focus:ring-primary focus:border-transparent"
                        placeholder={brandName}
                      />
                      <button
                        type="button"
                        onClick={() => handleBrandNameSubmit({ preventDefault: () => {} } as React.FormEvent)}
                        disabled={updateBrandNameMutation.isPending}
                        className="text-primary text-sm font-medium hover:underline disabled:opacity-50 flex-shrink-0"
                      >
                        {updateBrandNameMutation.isPending ? '…' : 'Save'}
                      </button>
                    </div>
                  </div>

                  <div className="space-y-3">
                    <p className="block font-medium text-white">Social links (email footer)</p>
                    <p className="text-xs text-white/50 -mt-1">URLs for X, Instagram and TikTok shown in transactional email footers.</p>
                    <div>
                      <label htmlFor="social_x_url" className="block text-sm text-white/75 mt-2">X (Twitter)</label>
                      <div className="mt-1 flex items-center gap-2">
                        <input
                          id="social_x_url"
                          type="url"
                          value={socialXUrlInput}
                          onChange={(e) => setSocialXUrlInput(e.target.value)}
                          className="flex-1 min-w-0 px-3 py-2 text-sm border border-white/[0.15] rounded-lg focus:ring-2 focus:ring-primary focus:border-transparent"
                          placeholder="https://x.com/yauga_wellbeing"
                        />
                        <button
                          type="button"
                          onClick={() => handleSocialXUrlSubmit({ preventDefault: () => {} } as React.FormEvent)}
                          disabled={updateSocialXUrlMutation.isPending}
                          className="text-primary text-sm font-medium hover:underline disabled:opacity-50 flex-shrink-0"
                        >
                          {updateSocialXUrlMutation.isPending ? '…' : 'Save'}
                        </button>
                      </div>
                    </div>
                    <div>
                      <label htmlFor="social_instagram_url" className="block text-sm text-white/75 mt-2">Instagram</label>
                      <div className="mt-1 flex items-center gap-2">
                        <input
                          id="social_instagram_url"
                          type="url"
                          value={socialInstagramUrlInput}
                          onChange={(e) => setSocialInstagramUrlInput(e.target.value)}
                          className="flex-1 min-w-0 px-3 py-2 text-sm border border-white/[0.15] rounded-lg focus:ring-2 focus:ring-primary focus:border-transparent"
                          placeholder="https://instagram.com/yauga_wellbeing"
                        />
                        <button
                          type="button"
                          onClick={() => handleSocialInstagramUrlSubmit({ preventDefault: () => {} } as React.FormEvent)}
                          disabled={updateSocialInstagramUrlMutation.isPending}
                          className="text-primary text-sm font-medium hover:underline disabled:opacity-50 flex-shrink-0"
                        >
                          {updateSocialInstagramUrlMutation.isPending ? '…' : 'Save'}
                        </button>
                      </div>
                    </div>
                    <div>
                      <label htmlFor="social_tiktok_url" className="block text-sm text-white/75 mt-2">TikTok</label>
                      <div className="mt-1 flex items-center gap-2">
                        <input
                          id="social_tiktok_url"
                          type="url"
                          value={socialTiktokUrlInput}
                          onChange={(e) => setSocialTiktokUrlInput(e.target.value)}
                          className="flex-1 min-w-0 px-3 py-2 text-sm border border-white/[0.15] rounded-lg focus:ring-2 focus:ring-primary focus:border-transparent"
                          placeholder="https://www.tiktok.com/shaolin_kris"
                        />
                        <button
                          type="button"
                          onClick={() => handleSocialTiktokUrlSubmit({ preventDefault: () => {} } as React.FormEvent)}
                          disabled={updateSocialTiktokUrlMutation.isPending}
                          className="text-primary text-sm font-medium hover:underline disabled:opacity-50 flex-shrink-0"
                        >
                          {updateSocialTiktokUrlMutation.isPending ? '…' : 'Save'}
                        </button>
                      </div>
                    </div>
                  </div>

                  <div>
                    <label htmlFor="email_from" className="block font-medium text-white">Email From (sender address)</label>
                    <p className="text-xs text-white/50 mt-0.5">Sender for all transactional emails. Format: Display Name &lt;email@domain.com&gt;</p>
                    <div className="mt-1.5 flex items-center gap-2">
                      <input
                        id="email_from"
                        type="text"
                        value={emailFrom}
                        onChange={(e) => setEmailFrom(e.target.value)}
                        className="flex-1 min-w-0 px-3 py-2 text-sm border border-white/[0.15] rounded-lg focus:ring-2 focus:ring-primary focus:border-transparent"
                        placeholder="Yauga &lt;noreply@yauga.com&gt;"
                      />
                      <button
                        type="button"
                        onClick={() => handleEmailFromSubmit({ preventDefault: () => {} } as React.FormEvent)}
                        disabled={updateEmailFromMutation.isPending}
                        className="text-primary text-sm font-medium hover:underline disabled:opacity-50 flex-shrink-0"
                      >
                        {updateEmailFromMutation.isPending ? '…' : 'Save'}
                      </button>
                    </div>
                  </div>

                  <div>
                    <label htmlFor="legal_email" className="block font-medium text-white">Legal Email</label>
                    <p className="text-xs text-white/50 mt-0.5">Contact email used in geocoding User-Agent and legal pages.</p>
                    <div className="mt-1.5 flex items-center gap-2">
                      <input
                        id="legal_email"
                        type="email"
                        value={legalEmailInput}
                        onChange={(e) => setLegalEmailInput(e.target.value)}
                        className="flex-1 min-w-0 px-3 py-2 text-sm border border-white/[0.15] rounded-lg focus:ring-2 focus:ring-primary focus:border-transparent"
                        placeholder="legal@example.com"
                      />
                      <button
                        type="button"
                        onClick={() => handleLegalEmailSubmit({ preventDefault: () => {} } as React.FormEvent)}
                        disabled={updateLegalEmailMutation.isPending}
                        className="text-primary text-sm font-medium hover:underline disabled:opacity-50 flex-shrink-0"
                      >
                        {updateLegalEmailMutation.isPending ? '…' : 'Save'}
                      </button>
                    </div>
                  </div>

                  <div>
                    <label htmlFor="admin_email" className="block font-medium text-white">Admin Email(s) *</label>
                    <p className="text-xs text-white/50 mt-0.5">Separate multiple with semicolons.</p>
                    <div className="mt-1.5 flex items-start gap-2">
                      <textarea
                        id="admin_email"
                        value={adminEmail}
                        onChange={(e) => setAdminEmail(e.target.value)}
                        className="flex-1 min-w-0 px-3 py-2 text-sm border border-white/[0.15] rounded-lg focus:ring-2 focus:ring-primary focus:border-transparent resize-y"
                        placeholder="admin@example.com; other@example.com"
                        rows={2}
                      />
                      <button
                        type="button"
                        onClick={() => handleAdminEmailSubmit({ preventDefault: () => {} } as React.FormEvent)}
                        disabled={updateAdminEmailMutation.isPending}
                        className="text-primary text-sm font-medium hover:underline disabled:opacity-50 flex-shrink-0"
                      >
                        {updateAdminEmailMutation.isPending ? '…' : 'Save'}
                      </button>
                    </div>
                  </div>

                  <div>
                    <label htmlFor="carousel_delay" className="block font-medium text-white">Carousel Delay</label>
                    <p className="text-xs text-white/50 mt-0.5">Time per slide before auto-advance. Min 1000ms.</p>
                    <div className="mt-1.5 flex items-center gap-2">
                      <input
                        type="number"
                        id="carousel_delay"
                        value={carouselDelay}
                        onChange={(e) => setCarouselDelay(e.target.value)}
                        className="w-28 px-3 py-2 text-sm border border-white/[0.15] rounded-lg focus:ring-2 focus:ring-primary focus:border-transparent"
                        min={1000}
                        step={500}
                      />
                      <span className="text-xs text-white/50">= {Math.round(parseInt(carouselDelay || '5000', 10) / 1000)}s</span>
                      <button
                        type="button"
                        onClick={() => {
                          const d = parseInt(carouselDelay, 10)
                          if (isNaN(d) || d < 1000) { toast.error('Carousel delay must be at least 1000ms'); return }
                          updateCarouselDelayMutation.mutate(carouselDelay)
                        }}
                        disabled={updateCarouselDelayMutation.isPending}
                        className="text-primary text-sm font-medium hover:underline disabled:opacity-50"
                      >
                        {updateCarouselDelayMutation.isPending ? '…' : 'Save'}
                      </button>
                    </div>
                  </div>

                  <div>
                    <label htmlFor="homepage_events_limit" className="block font-medium text-white">
                      Homepage events shown
                    </label>
                    <p className="text-xs text-white/50 mt-0.5">
                      Maximum upcoming events on the public homepage when visitors have not chosen a country or place search (1–200). Default 15.
                    </p>
                    <div className="mt-1.5 flex items-center gap-2">
                      <input
                        type="number"
                        id="homepage_events_limit"
                        value={homepageEventsLimitInput}
                        onChange={(e) => setHomepageEventsLimitInput(e.target.value)}
                        className="w-24 px-3 py-2 text-sm border border-white/[0.15] rounded-lg focus:ring-2 focus:ring-primary focus:border-transparent"
                        min={1}
                        max={200}
                        step={1}
                      />
                      <button
                        type="button"
                        onClick={() => {
                          const n = parseInt(homepageEventsLimitInput, 10)
                          if (!Number.isFinite(n) || n < 1 || n > 200) {
                            toast.error('Enter a whole number between 1 and 200.')
                            return
                          }
                          updateHomepageEventsLimitMutation.mutate(String(n))
                        }}
                        disabled={updateHomepageEventsLimitMutation.isPending}
                        className="text-primary text-sm font-medium hover:underline disabled:opacity-50"
                      >
                        {updateHomepageEventsLimitMutation.isPending ? '…' : 'Save'}
                      </button>
                    </div>
                  </div>

                  <div>
                    <span className="block font-medium text-white">Featured events carousel</span>
                    <p className="text-xs text-white/50 mt-0.5">
                      How many featured events appear on each slide. With six featured events, “2 per slide” yields three pages; “3 per slide” yields two.
                    </p>
                    <div className="mt-2 inline-flex rounded-lg border border-white/[0.15] p-0.5">
                      <button
                        type="button"
                        onClick={() => {
                          if (featuredEventsPerSlide === '2') return
                          setFeaturedEventsPerSlide('2')
                          updateFeaturedEventsPerSlideMutation.mutate('2')
                        }}
                        disabled={updateFeaturedEventsPerSlideMutation.isPending}
                        className={`rounded-md px-3 py-1.5 text-sm font-medium transition ${
                          featuredEventsPerSlide === '2'
                            ? 'btn-haus-fill'
                            : 'text-white/70 hover:text-white'
                        } disabled:opacity-50`}
                      >
                        2 per slide
                      </button>
                      <button
                        type="button"
                        onClick={() => {
                          if (featuredEventsPerSlide === '3') return
                          setFeaturedEventsPerSlide('3')
                          updateFeaturedEventsPerSlideMutation.mutate('3')
                        }}
                        disabled={updateFeaturedEventsPerSlideMutation.isPending}
                        className={`rounded-md px-3 py-1.5 text-sm font-medium transition ${
                          featuredEventsPerSlide === '3'
                            ? 'btn-haus-fill'
                            : 'text-white/70 hover:text-white'
                        } disabled:opacity-50`}
                      >
                        3 per slide
                      </button>
                    </div>
                  </div>

                  <div>
                    <label className="block font-medium text-white">Booking Fee</label>
                    <p className="text-xs text-white/50 mt-0.5">Fixed amount per booking (currency agnostic) or fixed percentage of ticket price.</p>
                    <div className="mt-1.5 flex flex-wrap items-center gap-3">
                      <label className="flex items-center gap-2 cursor-pointer">
                        <input
                          type="checkbox"
                          id="booking_fee_enabled"
                          checked={bookingFeeEnabled}
                          onChange={(e) => {
                            const v = e.target.checked
                            setBookingFeeEnabled(v)
                            updateBookingFeeEnabledMutation.mutate(v)
                          }}
                          className="h-4 w-4 text-primary focus:ring-primary border-white/[0.15] rounded"
                        />
                        <span className="text-sm text-white/75">Enable</span>
                      </label>
                      {bookingFeeEnabled && (
                        <>
                          <div className="flex items-center gap-2 border border-white/[0.15] rounded-lg p-1 bg-[#070707]">
                            <button
                              type="button"
                              onClick={() => {
                                setBookingFeeType('fixed')
                                updateBookingFeeTypeMutation.mutate('fixed')
                              }}
                              className={`px-3 py-1.5 text-sm font-medium rounded-md transition-colors ${
                                bookingFeeType === 'fixed' ? 'bg-[#0B0B0D] text-primary shadow-sm border border-white/[0.12]' : 'text-white/65 hover:text-white'
                              }`}
                            >
                              Fixed
                            </button>
                            <button
                              type="button"
                              onClick={() => {
                                setBookingFeeType('percentage')
                                updateBookingFeeTypeMutation.mutate('percentage')
                              }}
                              className={`px-3 py-1.5 text-sm font-medium rounded-md transition-colors ${
                                bookingFeeType === 'percentage' ? 'bg-[#0B0B0D] text-primary shadow-sm border border-white/[0.12]' : 'text-white/65 hover:text-white'
                              }`}
                            >
                              %
                            </button>
                          </div>
                          <input
                            type="number"
                            id="booking_fee"
                            value={bookingFee}
                            onChange={(e) => setBookingFee(e.target.value)}
                            className="w-24 px-3 py-2 text-sm border border-white/[0.15] rounded-lg focus:ring-2 focus:ring-primary"
                            min={0}
                            step={bookingFeeType === 'percentage' ? 0.1 : 0.01}
                            placeholder={bookingFeeType === 'percentage' ? '5' : '0'}
                          />
                          <span className="text-sm text-white/50">
                            {bookingFeeType === 'percentage' ? '%' : '£'}
                          </span>
                          <button
                            type="button"
                            onClick={() => {
                              const f = parseFloat(bookingFee)
                              if (isNaN(f) || f < 0) {
                                toast.error(bookingFeeType === 'percentage' ? 'Percentage must be ≥ 0' : 'Booking fee must be ≥ 0')
                                return
                              }
                              if (bookingFeeType === 'percentage' && f > 100) {
                                toast.error('Percentage cannot exceed 100')
                                return
                              }
                              updateBookingFeeMutation.mutate(bookingFee)
                            }}
                            disabled={updateBookingFeeMutation.isPending}
                            className="text-primary text-sm font-medium hover:underline disabled:opacity-50"
                          >
                            {updateBookingFeeMutation.isPending ? '…' : 'Save'}
                          </button>
                        </>
                      )}
                    </div>
                  </div>
                </div>

                <div className="space-y-5">
                  <div className="flex items-center justify-between gap-4">
                    <div className="min-w-0">
                      <label htmlFor="discount_codes_enabled" className="block font-medium text-white">Discount Codes</label>
                      <p className="text-xs text-white/50 mt-0.5">Users can apply codes at checkout.</p>
                    </div>
                    <label htmlFor="discount_codes_enabled" className="flex items-center gap-2 cursor-pointer flex-shrink-0">
                      <input
                        type="checkbox"
                        id="discount_codes_enabled"
                        checked={discountCodesEnabled}
                        onChange={(e) => { const v = e.target.checked; setDiscountCodesEnabled(v); updateDiscountCodesEnabledMutation.mutate(v) }}
                        className="h-4 w-4 text-primary focus:ring-primary border-white/[0.15] rounded"
                      />
                      <span className="text-sm text-white/75">{discountCodesEnabled ? 'On' : 'Off'}</span>
                    </label>
                  </div>

                  <div className="flex items-center justify-between gap-4">
                    <div className="min-w-0">
                      <label htmlFor="community_enabled" className="block font-medium text-white">Community</label>
                      <p className="text-xs text-white/50 mt-0.5">
                        Show Community in the site menu and allow /community (leaderboards and posts).
                      </p>
                    </div>
                    <label htmlFor="community_enabled" className="flex items-center gap-2 cursor-pointer flex-shrink-0">
                      <input
                        type="checkbox"
                        id="community_enabled"
                        checked={communityEnabled}
                        onChange={(e) => {
                          const v = e.target.checked
                          setCommunityEnabled(v)
                          updateCommunityEnabledMutation.mutate(v)
                        }}
                        className="h-4 w-4 text-primary focus:ring-primary border-white/[0.15] rounded"
                      />
                      <span className="text-sm text-white/75">{communityEnabled ? 'On' : 'Off'}</span>
                    </label>
                  </div>

                  <div className="flex items-center justify-between gap-4">
                    <div className="min-w-0">
                      <label htmlFor="enable_sharing" className="block font-medium text-white">Social Media Sharing</label>
                      <p className="text-xs text-white/50 mt-0.5">Share events and earn loyalty points.</p>
                    </div>
                    <label htmlFor="enable_sharing" className="flex items-center gap-2 cursor-pointer flex-shrink-0">
                      <input
                        type="checkbox"
                        id="enable_sharing"
                        checked={enableSharing}
                        onChange={(e) => { const v = e.target.checked; setEnableSharing(v); updateEnableSharingMutation.mutate(v) }}
                        className="h-4 w-4 text-primary focus:ring-primary border-white/[0.15] rounded"
                      />
                      <span className="text-sm text-white/75">{enableSharing ? 'On' : 'Off'}</span>
                    </label>
                  </div>

                  <div className="flex items-center justify-between gap-4">
                    <div className="min-w-0">
                      <label htmlFor="enable_google_wallet" className="block font-medium text-white">Google Wallet</label>
                      <p className="text-xs text-white/50 mt-0.5">&quot;Add to Google Wallet&quot; after purchase, in email and under QR.</p>
                    </div>
                    <label htmlFor="enable_google_wallet" className="flex items-center gap-2 cursor-pointer flex-shrink-0">
                      <input
                        type="checkbox"
                        id="enable_google_wallet"
                        checked={enableGoogleWallet}
                        onChange={(e) => { const v = e.target.checked; setEnableGoogleWallet(v); updateEnableGoogleWalletMutation.mutate(v) }}
                        className="h-4 w-4 text-primary focus:ring-primary border-white/[0.15] rounded"
                      />
                      <span className="text-sm text-white/75">{enableGoogleWallet ? 'On' : 'Off'}</span>
                    </label>
                  </div>

                  <div className="flex items-center justify-between gap-4">
                    <div className="min-w-0">
                      <label htmlFor="enable_apple_wallet" className="block font-medium text-white">Apple Wallet</label>
                      <p className="text-xs text-white/50 mt-0.5">&quot;Add to Apple Wallet&quot; (integration can be added later).</p>
                    </div>
                    <label htmlFor="enable_apple_wallet" className="flex items-center gap-2 cursor-pointer flex-shrink-0">
                      <input
                        type="checkbox"
                        id="enable_apple_wallet"
                        checked={enableAppleWallet}
                        onChange={(e) => { const v = e.target.checked; setEnableAppleWallet(v); updateEnableAppleWalletMutation.mutate(v) }}
                        className="h-4 w-4 text-primary focus:ring-primary border-white/[0.15] rounded"
                      />
                      <span className="text-sm text-white/75">{enableAppleWallet ? 'On' : 'Off'}</span>
                    </label>
                  </div>
                </div>
              </div>

              <div className="mt-6 border-t border-white/[0.12] pt-4">
                <div className="flex flex-wrap items-start justify-between gap-3 mb-4">
                  <div>
                    <h3 className="font-medium text-white">Registered Entity</h3>
                    <p className="text-xs text-white/50 mt-0.5">Company info for VAT receipts and invoices.</p>
                  </div>
                  <button
                    type="button"
                    onClick={() => {
                      updateRegisteredEntityNameMutation.mutate(registeredEntityName)
                      updateRegisteredEntityAddressMutation.mutate(registeredEntityAddress)
                      updateRegisteredEntityCompanyNumberMutation.mutate(registeredEntityCompanyNumber)
                      updateRegisteredEntityTaxNumberMutation.mutate(registeredEntityTaxNumber)
                    }}
                    disabled={
                      updateRegisteredEntityNameMutation.isPending ||
                      updateRegisteredEntityAddressMutation.isPending ||
                      updateRegisteredEntityCompanyNumberMutation.isPending ||
                      updateRegisteredEntityTaxNumberMutation.isPending
                    }
                    className="text-primary text-sm font-medium hover:underline disabled:opacity-50"
                  >
                    {updateRegisteredEntityNameMutation.isPending || updateRegisteredEntityAddressMutation.isPending || updateRegisteredEntityCompanyNumberMutation.isPending || updateRegisteredEntityTaxNumberMutation.isPending ? '…' : 'Save all'}
                  </button>
                </div>
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                  <div>
                    <label htmlFor="registered_entity_name" className="block text-sm font-medium text-white/75">Name</label>
                    <input
                      type="text"
                      id="registered_entity_name"
                      value={registeredEntityName}
                      onChange={(e) => setRegisteredEntityName(e.target.value)}
                      className="mt-1 w-full px-3 py-2 text-sm border border-white/[0.15] rounded-lg focus:ring-2 focus:ring-primary focus:border-transparent"
                      placeholder="Yauga Haus Ltd"
                    />
                  </div>
                  <div>
                    <label htmlFor="registered_entity_company_number" className="block text-sm font-medium text-white/75">Company Number</label>
                    <input
                      type="text"
                      id="registered_entity_company_number"
                      value={registeredEntityCompanyNumber}
                      onChange={(e) => setRegisteredEntityCompanyNumber(e.target.value)}
                      className="mt-1 w-full px-3 py-2 text-sm border border-white/[0.15] rounded-lg focus:ring-2 focus:ring-primary focus:border-transparent"
                      placeholder="12345678"
                    />
                  </div>
                  <div className="sm:col-span-2">
                    <label htmlFor="registered_entity_address" className="block text-sm font-medium text-white/75">Address</label>
                    <textarea
                      id="registered_entity_address"
                      value={registeredEntityAddress}
                      onChange={(e) => setRegisteredEntityAddress(e.target.value)}
                      className="mt-1 w-full px-3 py-2 text-sm border border-white/[0.15] rounded-lg focus:ring-2 focus:ring-primary focus:border-transparent resize-y"
                      placeholder="123 Business St, City, Postcode"
                      rows={2}
                    />
                  </div>
                  <div>
                    <label htmlFor="registered_entity_tax_number" className="block text-sm font-medium text-white/75">Tax (VAT) Number</label>
                    <input
                      type="text"
                      id="registered_entity_tax_number"
                      value={registeredEntityTaxNumber}
                      onChange={(e) => setRegisteredEntityTaxNumber(e.target.value)}
                      className="mt-1 w-full px-3 py-2 text-sm border border-white/[0.15] rounded-lg focus:ring-2 focus:ring-primary focus:border-transparent"
                      placeholder="GB123456789"
                    />
                  </div>
                </div>
              </div>
            </AdminSettingsSection>

            <AdminSettingsSection
              title="Analytics & ads"
              description="Campaign Pixel, GA4, and Google Ads conversion IDs. Change here without redeploying."
              open={settingsAnalyticsOpen}
              onToggle={() => setSettingsAnalyticsOpen((v) => !v)}
            >
              <AdminAnalyticsSettings />
            </AdminSettingsSection>

            <AdminSettingsSection
              title="Shop"
              open={settingsShopOpen}
              onToggle={() => setSettingsShopOpen((v) => !v)}
            >
              <div className="flex items-center justify-between gap-4">
                <div className="min-w-0">
                  <label htmlFor="shop_enabled" className="block font-medium text-white">Shop</label>
                  <p className="text-xs text-white/50 mt-0.5">Show the shop catalogue and checkout. When off, /shop is unavailable.</p>
                </div>
                <label htmlFor="shop_enabled" className="flex items-center gap-2 cursor-pointer flex-shrink-0">
                  <input
                    type="checkbox"
                    id="shop_enabled"
                    checked={shopEnabled}
                    onChange={(e) => {
                      const v = e.target.checked
                      setShopEnabled(v)
                      updateShopEnabledMutation.mutate(v)
                    }}
                    className="h-4 w-4 text-primary focus:ring-primary border-white/[0.15] rounded"
                  />
                  <span className="text-sm text-white/75">{shopEnabled ? 'On' : 'Off'}</span>
                </label>
              </div>
            </AdminSettingsSection>

            <AdminSettingsSection
              title="Meditation"
              open={settingsMeditationOpen}
              onToggle={() => setSettingsMeditationOpen((v) => !v)}
            >
              <div className="flex items-center justify-between gap-4">
                <div className="min-w-0">
                  <label htmlFor="meditation_enabled" className="block font-medium text-white">Meditation</label>
                  <p className="text-xs text-white/50 mt-0.5">
                    Show Meditation in the site menu and allow weekly pillar sessions. When off, /meditation is hidden from members.
                  </p>
                </div>
                <label htmlFor="meditation_enabled" className="flex items-center gap-2 cursor-pointer flex-shrink-0">
                  <input
                    type="checkbox"
                    id="meditation_enabled"
                    checked={meditationEnabled}
                    onChange={(e) => {
                      const v = e.target.checked
                      setMeditationEnabled(v)
                      updateMeditationEnabledMutation.mutate(v)
                    }}
                    className="h-4 w-4 text-primary focus:ring-primary border-white/[0.15] rounded"
                  />
                  <span className="text-sm text-white/75">{meditationEnabled ? 'On' : 'Off'}</span>
                </label>
              </div>
              <MeditationAccessSetting />
            </AdminSettingsSection>

            <AdminSettingsSection
              title="Chatbot"
              description="Site chat widget. Knowledge from FAQs, articles, and an optional Markdown backup."
              open={settingsChatbotOpen}
              onToggle={() => setSettingsChatbotOpen((v) => !v)}
            >
              <AdminChatbotSettings />
            </AdminSettingsSection>

            <AdminSettingsSection
              title="Ring"
              open={settingsRingOpen}
              onToggle={() => setSettingsRingOpen((v) => !v)}
            >
              <div className="space-y-4">
                <div>
                  <h3 className="font-medium text-white">Yauga State</h3>
                  <p className="text-xs text-white/50 mt-0.5">
                    Ring sync, optional Health Connect dashboard, weekly challenges, and verified
                    metric points. Ring sync requires the Android or iOS app.
                  </p>
                </div>

                <div className="flex items-center justify-between gap-4">
                  <div className="min-w-0">
                    <label htmlFor="vitality_enabled" className="block font-medium text-white text-sm">
                      Enable Yauga Ring
                    </label>
                    <p className="text-xs text-white/50 mt-0.5">
                      Show Yauga Ring nav / `/ring` for members.
                    </p>
                  </div>
                  <label htmlFor="vitality_enabled" className="flex items-center gap-2 cursor-pointer flex-shrink-0">
                    <input
                      type="checkbox"
                      id="vitality_enabled"
                      checked={vitalityEnabled}
                      onChange={(e) => {
                        const v = e.target.checked
                        setVitalityEnabled(v)
                        updateVitalityEnabledMutation.mutate(v)
                      }}
                      className="h-4 w-4 text-primary focus:ring-primary border-white/[0.15] rounded"
                    />
                    <span className="text-sm text-white/75">{vitalityEnabled ? 'On' : 'Off'}</span>
                  </label>
                </div>

                <div className="flex items-center justify-between gap-4">
                  <div className="min-w-0">
                    <label htmlFor="use_health_connect" className="block font-medium text-white text-sm">
                      Use Health Connect?
                    </label>
                    <p className="text-xs text-white/50 mt-0.5">
                      When Yes, show Yauga State on My Dashboard and allow Health Connect sync.
                    </p>
                  </div>
                  <label
                    htmlFor="use_health_connect"
                    className="flex items-center gap-2 cursor-pointer flex-shrink-0"
                  >
                    <input
                      type="checkbox"
                      id="use_health_connect"
                      checked={useHealthConnect}
                      onChange={(e) => {
                        const v = e.target.checked
                        setUseHealthConnect(v)
                        updateUseHealthConnectMutation.mutate(v)
                      }}
                      className="h-4 w-4 text-primary focus:ring-primary border-white/[0.15] rounded"
                    />
                    <span className="text-sm text-white/75">{useHealthConnect ? 'Yes' : 'No'}</span>
                  </label>
                </div>

                <div className="border-t border-white/[0.08] pt-4 space-y-3">
                  <div>
                    <p className="font-medium text-white text-sm">Points per verified metric</p>
                    <p className="text-xs text-white/50 mt-0.5">
                      Once per calendar day for each of:{' '}
                      {VERIFIED_METRIC_KEYS.map((k) => VERIFIED_METRIC_LABELS[k]).join(', ')}.
                      Applies to ring Reads and Health Connect sync.
                    </p>
                  </div>
                  <div className="flex flex-wrap items-end gap-3">
                    <div>
                      <label
                        htmlFor="vitality_verified_points"
                        className="block text-[10px] uppercase text-white/40 mb-0.5"
                      >
                        Points each
                      </label>
                      <input
                        id="vitality_verified_points"
                        type="number"
                        min={1}
                        max={500}
                        value={verifiedMetricPointsDraft.pointsPerMetric}
                        onChange={(e) =>
                          setVerifiedMetricPointsDraft({
                            pointsPerMetric: Math.max(1, Math.min(500, Number(e.target.value) || 1)),
                          })
                        }
                        className="w-28 rounded-lg border border-white/[0.15] bg-[#0B0B0D] px-2 py-1.5 text-sm text-white"
                      />
                    </div>
                    <button
                      type="button"
                      onClick={() =>
                        updateVerifiedMetricPointsMutation.mutate(verifiedMetricPointsDraft)
                      }
                      disabled={updateVerifiedMetricPointsMutation.isPending}
                      className="btn-haus-fill rounded-lg px-3 py-1.5 text-xs font-semibold disabled:opacity-50"
                    >
                      {updateVerifiedMetricPointsMutation.isPending ? 'Saving…' : 'Save points'}
                    </button>
                  </div>
                </div>

                <div className="flex items-center justify-between gap-4">
                  <div className="min-w-0">
                    <label htmlFor="health_connect_debug" className="block font-medium text-white text-sm">
                      Health Connect Debug (Admin)
                    </label>
                    <p className="text-xs text-white/50 mt-0.5">
                      Admins see a Health Connect debug console on the dashboard when connecting/syncing.
                    </p>
                  </div>
                  <label
                    htmlFor="health_connect_debug"
                    className="flex items-center gap-2 cursor-pointer flex-shrink-0"
                  >
                    <input
                      type="checkbox"
                      id="health_connect_debug"
                      checked={healthConnectDebug}
                      onChange={(e) => {
                        const v = e.target.checked
                        setHealthConnectDebug(v)
                        updateHealthConnectDebugMutation.mutate(v)
                      }}
                      className="h-4 w-4 text-primary focus:ring-primary border-white/[0.15] rounded"
                    />
                    <span className="text-sm text-white/75">{healthConnectDebug ? 'On' : 'Off'}</span>
                  </label>
                </div>

                <div className="flex items-center justify-between gap-4">
                  <div className="min-w-0">
                    <label
                      htmlFor="ring_diagnostics_enabled"
                      className="block font-medium text-white text-sm"
                    >
                      Show Ring Diagnostics (admin only, native app)
                    </label>
                    <p className="text-xs text-white/50 mt-0.5">
                      When On, admins see Ring Diagnostics in the native app nav and on `/ring`. Hidden on
                      web. Members never see it.
                    </p>
                  </div>
                  <label
                    htmlFor="ring_diagnostics_enabled"
                    className="flex items-center gap-2 cursor-pointer flex-shrink-0"
                  >
                    <input
                      type="checkbox"
                      id="ring_diagnostics_enabled"
                      checked={ringDiagnosticsEnabled}
                      onChange={(e) => {
                        const v = e.target.checked
                        setRingDiagnosticsEnabled(v)
                        updateRingDiagnosticsMutation.mutate(v)
                      }}
                      className="h-4 w-4 text-primary focus:ring-primary border-white/[0.15] rounded"
                    />
                    <span className="text-sm text-white/75">
                      {ringDiagnosticsEnabled ? 'On' : 'Off'}
                    </span>
                  </label>
                </div>

                <div className="border-t border-white/[0.08] pt-4 space-y-3">
                  <div>
                    <p className="font-medium text-white text-sm">Yauga Ring (verified tier)</p>
                    <p className="text-xs text-white/50 mt-0.5">
                      Health Connect attaches an Android package name to every record. Sync lists those
                      origins in the member panel / debug log. Paste the Yauga Ring app package here once
                      known- matching data unlocks verified state and the weekly bonus below.
                    </p>
                  </div>
                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                    <div className="sm:col-span-2">
                      <label
                        htmlFor="vitality_yauga_ring_package"
                        className="block text-[10px] uppercase text-white/40 mb-0.5"
                      >
                        Android package name
                      </label>
                      <input
                        id="vitality_yauga_ring_package"
                        type="text"
                        placeholder="com.shrring.ring"
                        value={vitalityYaugaRingDraft.packageName}
                        onChange={(e) =>
                          setVitalityYaugaRingDraft((prev) => ({
                            ...prev,
                            packageName: e.target.value,
                          }))
                        }
                        className="w-full rounded-lg border border-white/[0.15] bg-[#0B0B0D] px-2 py-1.5 text-sm text-white font-mono"
                      />
                    </div>
                    <div>
                      <label
                        htmlFor="vitality_yauga_ring_display"
                        className="block text-[10px] uppercase text-white/40 mb-0.5"
                      >
                        Display name
                      </label>
                      <input
                        id="vitality_yauga_ring_display"
                        type="text"
                        value={vitalityYaugaRingDraft.displayName}
                        onChange={(e) =>
                          setVitalityYaugaRingDraft((prev) => ({
                            ...prev,
                            displayName: e.target.value,
                          }))
                        }
                        className="w-full rounded-lg border border-white/[0.15] bg-[#0B0B0D] px-2 py-1.5 text-sm text-white"
                      />
                    </div>
                    <div>
                      <label
                        htmlFor="vitality_yauga_ring_bonus"
                        className="block text-[10px] uppercase text-white/40 mb-0.5"
                      >
                        Verified weekly bonus (pts)
                      </label>
                      <input
                        id="vitality_yauga_ring_bonus"
                        type="number"
                        min={0}
                        max={200}
                        value={vitalityYaugaRingDraft.verifiedWeeklyBonus}
                        onChange={(e) => {
                          const verifiedWeeklyBonus = Math.max(
                            0,
                            Math.min(200, Number(e.target.value) || 0)
                          )
                          setVitalityYaugaRingDraft((prev) => ({ ...prev, verifiedWeeklyBonus }))
                        }}
                        className="w-full rounded-lg border border-white/[0.15] bg-[#0B0B0D] px-2 py-1.5 text-sm text-white tabular-nums"
                      />
                    </div>
                    <div>
                      <label
                        htmlFor="vitality_yauga_ring_stride"
                        className="block text-[10px] uppercase text-white/40 mb-0.5"
                      >
                        Ring stride (cm)
                      </label>
                      <input
                        id="vitality_yauga_ring_stride"
                        type="number"
                        min={40}
                        max={120}
                        value={vitalityYaugaRingDraft.strideCm}
                        onChange={(e) => {
                          const strideCm = Math.max(
                            40,
                            Math.min(120, Number(e.target.value) || 67)
                          )
                          setVitalityYaugaRingDraft((prev) => ({ ...prev, strideCm }))
                        }}
                        className="w-full rounded-lg border border-white/[0.15] bg-[#0B0B0D] px-2 py-1.5 text-sm text-white tabular-nums"
                      />
                    </div>
                    <div>
                      <label
                        htmlFor="vitality_daily_workout_points"
                        className="block text-[10px] uppercase text-white/40 mb-0.5"
                      >
                        Daily Workout points
                      </label>
                      <input
                        id="vitality_daily_workout_points"
                        type="number"
                        min={0}
                        max={500}
                        value={vitalityYaugaRingDraft.dailyWorkoutPoints}
                        onChange={(e) => {
                          const dailyWorkoutPoints = Math.max(
                            0,
                            Math.min(500, Number(e.target.value) || 0)
                          )
                          setVitalityYaugaRingDraft((prev) => ({
                            ...prev,
                            dailyWorkoutPoints,
                          }))
                        }}
                        className="w-full rounded-lg border border-white/[0.15] bg-[#0B0B0D] px-2 py-1.5 text-sm text-white tabular-nums"
                      />
                      <p className="mt-1 text-[10px] text-white/35">
                        Awarded once per day for a workout over 30 minutes. Set 0 to disable.
                      </p>
                    </div>
                  </div>
                  <button
                    type="button"
                    onClick={() => updateVitalityYaugaRingMutation.mutate(vitalityYaugaRingDraft)}
                    disabled={updateVitalityYaugaRingMutation.isPending}
                    className="btn-haus-fill rounded-lg px-4 py-2 text-sm font-semibold disabled:opacity-50"
                  >
                    {updateVitalityYaugaRingMutation.isPending ? 'Saving…' : 'Save Yauga Ring setting'}
                  </button>
                </div>

                <div className="border-t border-white/[0.08] pt-4 space-y-3">
                  <div>
                    <p className="font-medium text-white text-sm">Reading guidance</p>
                    <p className="text-xs text-white/50 mt-0.5">
                      Tips and high/low thresholds shown in the ring reading modal. Leave a threshold
                      blank to disable that flag.
                    </p>
                  </div>
                  <div className="space-y-3">
                    {(Object.keys(RING_GUIDANCE_METRIC_LABELS) as RingGuidanceMetricKey[]).map(
                      (metricKey) => {
                        const entry = ringMetricGuidanceDraft[metricKey]
                        const idBase = `ring_guidance_${metricKey}`
                        return (
                          <div
                            key={metricKey}
                            className="rounded-lg border border-white/[0.08] bg-[#101014] p-3 space-y-3"
                          >
                            <p className="text-xs font-semibold uppercase tracking-wide text-white/45">
                              {RING_GUIDANCE_METRIC_LABELS[metricKey]}
                            </p>
                            <div>
                              <label
                                htmlFor={`${idBase}_tip`}
                                className="block text-[10px] uppercase text-white/40 mb-0.5"
                              >
                                Tip
                              </label>
                              <textarea
                                id={`${idBase}_tip`}
                                rows={2}
                                value={entry.tip}
                                onChange={(e) =>
                                  setRingMetricGuidanceDraft((prev) => ({
                                    ...prev,
                                    [metricKey]: { ...prev[metricKey], tip: e.target.value },
                                  }))
                                }
                                className="w-full rounded-lg border border-white/[0.15] bg-[#0B0B0D] px-2 py-1.5 text-sm text-white resize-y min-h-[3rem]"
                              />
                            </div>
                            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                              <div>
                                <label
                                  htmlFor={`${idBase}_high_threshold`}
                                  className="block text-[10px] uppercase text-white/40 mb-0.5"
                                >
                                  High threshold
                                </label>
                                <input
                                  id={`${idBase}_high_threshold`}
                                  type="number"
                                  placeholder="Off"
                                  value={entry.highThreshold ?? ''}
                                  onChange={(e) => {
                                    const raw = e.target.value.trim()
                                    setRingMetricGuidanceDraft((prev) => ({
                                      ...prev,
                                      [metricKey]: {
                                        ...prev[metricKey],
                                        highThreshold: raw === '' ? null : Number(raw),
                                      },
                                    }))
                                  }}
                                  className="w-full rounded-lg border border-white/[0.15] bg-[#0B0B0D] px-2 py-1.5 text-sm text-white tabular-nums"
                                />
                              </div>
                              <div>
                                <label
                                  htmlFor={`${idBase}_high_message`}
                                  className="block text-[10px] uppercase text-white/40 mb-0.5"
                                >
                                  High message
                                </label>
                                <input
                                  id={`${idBase}_high_message`}
                                  type="text"
                                  value={entry.highMessage}
                                  onChange={(e) =>
                                    setRingMetricGuidanceDraft((prev) => ({
                                      ...prev,
                                      [metricKey]: {
                                        ...prev[metricKey],
                                        highMessage: e.target.value,
                                      },
                                    }))
                                  }
                                  className="w-full rounded-lg border border-white/[0.15] bg-[#0B0B0D] px-2 py-1.5 text-sm text-white"
                                />
                              </div>
                              <div>
                                <label
                                  htmlFor={`${idBase}_low_threshold`}
                                  className="block text-[10px] uppercase text-white/40 mb-0.5"
                                >
                                  Low threshold
                                </label>
                                <input
                                  id={`${idBase}_low_threshold`}
                                  type="number"
                                  placeholder="Off"
                                  value={entry.lowThreshold ?? ''}
                                  onChange={(e) => {
                                    const raw = e.target.value.trim()
                                    setRingMetricGuidanceDraft((prev) => ({
                                      ...prev,
                                      [metricKey]: {
                                        ...prev[metricKey],
                                        lowThreshold: raw === '' ? null : Number(raw),
                                      },
                                    }))
                                  }}
                                  className="w-full rounded-lg border border-white/[0.15] bg-[#0B0B0D] px-2 py-1.5 text-sm text-white tabular-nums"
                                />
                              </div>
                              <div>
                                <label
                                  htmlFor={`${idBase}_low_message`}
                                  className="block text-[10px] uppercase text-white/40 mb-0.5"
                                >
                                  Low message
                                </label>
                                <input
                                  id={`${idBase}_low_message`}
                                  type="text"
                                  value={entry.lowMessage}
                                  onChange={(e) =>
                                    setRingMetricGuidanceDraft((prev) => ({
                                      ...prev,
                                      [metricKey]: {
                                        ...prev[metricKey],
                                        lowMessage: e.target.value,
                                      },
                                    }))
                                  }
                                  className="w-full rounded-lg border border-white/[0.15] bg-[#0B0B0D] px-2 py-1.5 text-sm text-white"
                                />
                              </div>
                            </div>
                            {metricKey === 'sleep' && (
                              <p className="text-[10px] text-white/35">
                                Sleep low threshold is in minutes (7 hours = 420).
                              </p>
                            )}
                          </div>
                        )
                      }
                    )}
                  </div>
                  <button
                    type="button"
                    onClick={() => updateRingMetricGuidanceMutation.mutate(ringMetricGuidanceDraft)}
                    disabled={updateRingMetricGuidanceMutation.isPending}
                    className="btn-haus-fill rounded-lg px-4 py-2 text-sm font-semibold disabled:opacity-50"
                  >
                    {updateRingMetricGuidanceMutation.isPending
                      ? 'Saving…'
                      : 'Save reading guidance'}
                  </button>
                </div>

                <div className="border-t border-white/[0.08] pt-4 space-y-3">
                  <div>
                    <p className="font-medium text-white text-sm">Health Connect devices</p>
                    <p className="text-xs text-white/50 mt-0.5">
                      Map Android package names to display names. Blank names show as a single “Other” on the
                      member dashboard. Packages appear here automatically after members sync.
                    </p>
                  </div>
                  <div className="space-y-2">
                    {vitalityDevicesDraft.length === 0 ? (
                      <p className="text-xs text-white/45">No devices yet- sync on Android to discover packages.</p>
                    ) : (
                      vitalityDevicesDraft.map((device, index) => (
                        <div
                          key={device.package_name}
                          className="grid grid-cols-1 sm:grid-cols-[1fr_minmax(0,12rem)_auto] gap-2 items-center rounded-lg border border-white/[0.08] bg-[#101014] px-3 py-2"
                        >
                          <p className="text-xs font-mono text-white/70 break-all">{device.package_name}</p>
                          <input
                            type="text"
                            placeholder="Other (if blank)"
                            value={device.display_name}
                            onChange={(e) => {
                              const display_name = e.target.value
                              setVitalityDevicesDraft((prev) =>
                                prev.map((d, i) => (i === index ? { ...d, display_name } : d))
                              )
                            }}
                            className="w-full rounded-lg border border-white/[0.15] bg-[#0B0B0D] px-2 py-1.5 text-sm text-white"
                          />
                          {device.package_name === vitalityYaugaRingDraft.packageName && (
                            <span className="text-[10px] uppercase tracking-wide text-emerald-300 font-semibold">
                              Preferred
                            </span>
                          )}
                        </div>
                      ))
                    )}
                  </div>
                  <div className="grid grid-cols-1 sm:grid-cols-[1fr_minmax(0,12rem)_auto] gap-2 items-end">
                    <div>
                      <label className="block text-[10px] uppercase text-white/40 mb-0.5">
                        Add package
                      </label>
                      <input
                        type="text"
                        placeholder="com.example.app"
                        value={newDevicePackage}
                        onChange={(e) => setNewDevicePackage(e.target.value)}
                        className="w-full rounded-lg border border-white/[0.15] bg-[#0B0B0D] px-2 py-1.5 text-sm text-white font-mono"
                      />
                    </div>
                    <div>
                      <label className="block text-[10px] uppercase text-white/40 mb-0.5">
                        Display name
                      </label>
                      <input
                        type="text"
                        placeholder="Optional"
                        value={newDeviceName}
                        onChange={(e) => setNewDeviceName(e.target.value)}
                        className="w-full rounded-lg border border-white/[0.15] bg-[#0B0B0D] px-2 py-1.5 text-sm text-white"
                      />
                    </div>
                    <button
                      type="button"
                      className="btn-haus-outline rounded-lg px-3 py-1.5 text-sm"
                      onClick={() => {
                        const pkg = newDevicePackage.trim()
                        if (!pkg) {
                          toast.error('Enter a package name')
                          return
                        }
                        if (
                          vitalityDevicesDraft.some(
                            (d) => d.package_name.toLowerCase() === pkg.toLowerCase()
                          )
                        ) {
                          toast.error('Package already listed')
                          return
                        }
                        setVitalityDevicesDraft((prev) => [
                          ...prev,
                          { package_name: pkg, display_name: newDeviceName.trim() },
                        ])
                        setNewDevicePackage('')
                        setNewDeviceName('')
                      }}
                    >
                      Add
                    </button>
                  </div>
                  <button
                    type="button"
                    onClick={() => saveVitalityDevicesMutation.mutate(vitalityDevicesDraft)}
                    disabled={saveVitalityDevicesMutation.isPending}
                    className="btn-haus-fill rounded-lg px-4 py-2 text-sm font-semibold disabled:opacity-50"
                  >
                    {saveVitalityDevicesMutation.isPending ? 'Saving…' : 'Save devices'}
                  </button>
                </div>

                <div className="border-t border-white/[0.08] pt-4 space-y-3">
                  <div className="flex flex-wrap items-end justify-between gap-3">
                    <div>
                      <p className="font-medium text-white text-sm">Weekly challenges</p>
                      <p className="text-xs text-white/50 mt-0.5">
                        Awarded on Health Connect sync when goals are met (Mon–Sun week). Disable a challenge to
                        hide it from members.
                      </p>
                    </div>
                    <div className="flex items-center gap-2">
                      <label htmlFor="vitality_weekly_cap" className="text-xs text-white/55 whitespace-nowrap">
                        Weekly points cap
                      </label>
                      <input
                        id="vitality_weekly_cap"
                        type="number"
                        min={1}
                        max={500}
                        value={vitalityChallengesDraft.weeklyCap}
                        onChange={(e) => {
                          const n = Math.max(1, Math.min(500, Number(e.target.value) || 1))
                          setVitalityChallengesDraft((prev) => ({ ...prev, weeklyCap: n }))
                        }}
                        className="w-20 rounded-lg border border-white/[0.15] bg-[#101014] px-2 py-1.5 text-sm text-white tabular-nums"
                      />
                    </div>
                  </div>

                  <div className="space-y-3">
                    {vitalityChallengesDraft.challenges.map((challenge, index) => (
                      <div
                        key={challenge.key}
                        className="rounded-lg border border-white/[0.08] bg-[#101014] p-3 space-y-2"
                      >
                        <div className="flex items-center justify-between gap-2">
                          <p className="text-xs font-semibold uppercase tracking-wide text-white/45">
                            {challenge.key}
                          </p>
                          <label className="flex items-center gap-2 cursor-pointer text-xs text-white/70">
                            <input
                              type="checkbox"
                              checked={challenge.enabled}
                              onChange={(e) => {
                                const enabled = e.target.checked
                                setVitalityChallengesDraft((prev) => {
                                  const challenges = prev.challenges.map((c, i) =>
                                    i === index ? { ...c, enabled } : c
                                  )
                                  return { ...prev, challenges }
                                })
                              }}
                              className="h-3.5 w-3.5 text-primary focus:ring-primary border-white/[0.15] rounded"
                            />
                            Enabled
                          </label>
                        </div>
                        <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
                          <div>
                            <label className="block text-[10px] uppercase text-white/40 mb-0.5">Title</label>
                            <input
                              type="text"
                              value={challenge.title}
                              onChange={(e) => {
                                const title = e.target.value
                                setVitalityChallengesDraft((prev) => {
                                  const challenges = prev.challenges.map((c, i) =>
                                    i === index ? { ...c, title } : c
                                  )
                                  return { ...prev, challenges }
                                })
                              }}
                              className="w-full rounded-lg border border-white/[0.15] bg-[#0B0B0D] px-2 py-1.5 text-sm text-white"
                            />
                          </div>
                          <div>
                            <label className="block text-[10px] uppercase text-white/40 mb-0.5">Points</label>
                            <input
                              type="number"
                              min={1}
                              max={200}
                              value={challenge.points}
                              onChange={(e) => {
                                const points = Math.max(1, Math.min(200, Number(e.target.value) || 1))
                                setVitalityChallengesDraft((prev) => {
                                  const challenges = prev.challenges.map((c, i) =>
                                    i === index ? { ...c, points } : c
                                  )
                                  return { ...prev, challenges }
                                })
                              }}
                              className="w-full rounded-lg border border-white/[0.15] bg-[#0B0B0D] px-2 py-1.5 text-sm text-white tabular-nums"
                            />
                          </div>
                        </div>
                        <div>
                          <label className="block text-[10px] uppercase text-white/40 mb-0.5">Description</label>
                          <input
                            type="text"
                            value={challenge.description}
                            onChange={(e) => {
                              const description = e.target.value
                              setVitalityChallengesDraft((prev) => {
                                const challenges = prev.challenges.map((c, i) =>
                                  i === index ? { ...c, description } : c
                                )
                                return { ...prev, challenges }
                              })
                            }}
                            className="w-full rounded-lg border border-white/[0.15] bg-[#0B0B0D] px-2 py-1.5 text-sm text-white"
                          />
                        </div>
                        {challenge.key === 'sleep_3_nights_7h' && (
                          <div className="grid grid-cols-2 gap-2">
                            <div>
                              <label className="block text-[10px] uppercase text-white/40 mb-0.5">
                                Min sleep (minutes)
                              </label>
                              <input
                                type="number"
                                min={60}
                                max={720}
                                value={challenge.minSleepMinutes ?? 420}
                                onChange={(e) => {
                                  const minSleepMinutes = Math.max(60, Number(e.target.value) || 420)
                                  setVitalityChallengesDraft((prev) => {
                                    const challenges = prev.challenges.map((c, i) =>
                                      i === index ? { ...c, minSleepMinutes } : c
                                    )
                                    return { ...prev, challenges }
                                  })
                                }}
                                className="w-full rounded-lg border border-white/[0.15] bg-[#0B0B0D] px-2 py-1.5 text-sm text-white tabular-nums"
                              />
                            </div>
                            <div>
                              <label className="block text-[10px] uppercase text-white/40 mb-0.5">
                                Nights required
                              </label>
                              <input
                                type="number"
                                min={1}
                                max={7}
                                value={challenge.minNights ?? 3}
                                onChange={(e) => {
                                  const minNights = Math.max(1, Math.min(7, Number(e.target.value) || 3))
                                  setVitalityChallengesDraft((prev) => {
                                    const challenges = prev.challenges.map((c, i) =>
                                      i === index ? { ...c, minNights } : c
                                    )
                                    return { ...prev, challenges }
                                  })
                                }}
                                className="w-full rounded-lg border border-white/[0.15] bg-[#0B0B0D] px-2 py-1.5 text-sm text-white tabular-nums"
                              />
                            </div>
                          </div>
                        )}
                        {challenge.key === 'steps_8k_3_days' && (
                          <div className="grid grid-cols-2 gap-2">
                            <div>
                              <label className="block text-[10px] uppercase text-white/40 mb-0.5">
                                Min steps / day
                              </label>
                              <input
                                type="number"
                                min={1000}
                                max={50000}
                                value={challenge.minSteps ?? 8000}
                                onChange={(e) => {
                                  const minSteps = Math.max(1000, Number(e.target.value) || 8000)
                                  setVitalityChallengesDraft((prev) => {
                                    const challenges = prev.challenges.map((c, i) =>
                                      i === index ? { ...c, minSteps } : c
                                    )
                                    return { ...prev, challenges }
                                  })
                                }}
                                className="w-full rounded-lg border border-white/[0.15] bg-[#0B0B0D] px-2 py-1.5 text-sm text-white tabular-nums"
                              />
                            </div>
                            <div>
                              <label className="block text-[10px] uppercase text-white/40 mb-0.5">
                                Days required
                              </label>
                              <input
                                type="number"
                                min={1}
                                max={7}
                                value={challenge.minDays ?? 3}
                                onChange={(e) => {
                                  const minDays = Math.max(1, Math.min(7, Number(e.target.value) || 3))
                                  setVitalityChallengesDraft((prev) => {
                                    const challenges = prev.challenges.map((c, i) =>
                                      i === index ? { ...c, minDays } : c
                                    )
                                    return { ...prev, challenges }
                                  })
                                }}
                                className="w-full rounded-lg border border-white/[0.15] bg-[#0B0B0D] px-2 py-1.5 text-sm text-white tabular-nums"
                              />
                            </div>
                          </div>
                        )}
                        {challenge.key === 'ritual_day_steps_5k' && (
                          <div>
                            <label className="block text-[10px] uppercase text-white/40 mb-0.5">
                              Min steps on attended-event day
                            </label>
                            <input
                              type="number"
                              min={1000}
                              max={50000}
                              value={challenge.minSteps ?? 5000}
                              onChange={(e) => {
                                const minSteps = Math.max(1000, Number(e.target.value) || 5000)
                                setVitalityChallengesDraft((prev) => {
                                  const challenges = prev.challenges.map((c, i) =>
                                    i === index ? { ...c, minSteps } : c
                                  )
                                  return { ...prev, challenges }
                                })
                              }}
                              className="w-full max-w-xs rounded-lg border border-white/[0.15] bg-[#0B0B0D] px-2 py-1.5 text-sm text-white tabular-nums"
                            />
                          </div>
                        )}
                      </div>
                    ))}
                  </div>

                  <button
                    type="button"
                    onClick={() => updateVitalityChallengesMutation.mutate(vitalityChallengesDraft)}
                    disabled={updateVitalityChallengesMutation.isPending}
                    className="btn-haus-fill rounded-lg px-4 py-2 text-sm font-semibold disabled:opacity-50"
                  >
                    {updateVitalityChallengesMutation.isPending ? 'Saving…' : 'Save weekly challenges'}
                  </button>
                </div>

                <div className="border-t border-white/[0.08] pt-4 space-y-3">
                  <div>
                    <p className="font-medium text-white text-sm">Ethical data partners</p>
                    <p className="text-xs text-white/50 mt-0.5">
                      Shown in member Yauga State → Preferences when Share my data is on. Points are per 7 days of
                      health data exchanged- actual sharing is not live yet.
                    </p>
                  </div>
                  <div className="space-y-3">
                    {vitalityPartnersDraft.map((partner, index) => (
                      <div
                        key={partner.id}
                        className="rounded-lg border border-white/[0.08] bg-[#101014] p-3 space-y-2"
                      >
                        <div className="flex items-center justify-between gap-2">
                          <p className="text-xs font-semibold text-white/45 tabular-nums">{partner.id}</p>
                          <label className="flex items-center gap-2 cursor-pointer text-xs text-white/70">
                            <input
                              type="checkbox"
                              checked={partner.enabled}
                              onChange={(e) => {
                                const enabled = e.target.checked
                                setVitalityPartnersDraft((prev) =>
                                  prev.map((p, i) => (i === index ? { ...p, enabled } : p))
                                )
                              }}
                              className="h-3.5 w-3.5 text-primary focus:ring-primary border-white/[0.15] rounded"
                            />
                            Enabled
                          </label>
                        </div>
                        <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
                          <div>
                            <label className="block text-[10px] uppercase text-white/40 mb-0.5">Name</label>
                            <input
                              type="text"
                              value={partner.name}
                              onChange={(e) => {
                                const name = e.target.value
                                setVitalityPartnersDraft((prev) =>
                                  prev.map((p, i) => (i === index ? { ...p, name } : p))
                                )
                              }}
                              className="w-full rounded-lg border border-white/[0.15] bg-[#0B0B0D] px-2 py-1.5 text-sm text-white"
                            />
                          </div>
                          <div>
                            <label className="block text-[10px] uppercase text-white/40 mb-0.5">
                              Points / 7 days
                            </label>
                            <input
                              type="number"
                              min={1}
                              max={500}
                              value={partner.pointsPerWeek}
                              onChange={(e) => {
                                const pointsPerWeek = Math.max(1, Math.min(500, Number(e.target.value) || 1))
                                setVitalityPartnersDraft((prev) =>
                                  prev.map((p, i) => (i === index ? { ...p, pointsPerWeek } : p))
                                )
                              }}
                              className="w-full rounded-lg border border-white/[0.15] bg-[#0B0B0D] px-2 py-1.5 text-sm text-white tabular-nums"
                            />
                          </div>
                        </div>
                        <div>
                          <label className="block text-[10px] uppercase text-white/40 mb-0.5">
                            Description
                          </label>
                          <input
                            type="text"
                            value={partner.description}
                            onChange={(e) => {
                              const description = e.target.value
                              setVitalityPartnersDraft((prev) =>
                                prev.map((p, i) => (i === index ? { ...p, description } : p))
                              )
                            }}
                            className="w-full rounded-lg border border-white/[0.15] bg-[#0B0B0D] px-2 py-1.5 text-sm text-white"
                          />
                        </div>
                      </div>
                    ))}
                  </div>
                  <button
                    type="button"
                    onClick={() => updateVitalityPartnersMutation.mutate(vitalityPartnersDraft)}
                    disabled={updateVitalityPartnersMutation.isPending}
                    className="btn-haus-fill rounded-lg px-4 py-2 text-sm font-semibold disabled:opacity-50"
                  >
                    {updateVitalityPartnersMutation.isPending ? 'Saving…' : 'Save data partners'}
                  </button>
                </div>
              </div>
            </AdminSettingsSection>

            <AdminSettingsSection
              title="Manager Bulk Upload"
              open={settingsManagerBulkOpen}
              onToggle={() => setSettingsManagerBulkOpen((v) => !v)}
            >
              <div className="flex items-center justify-between gap-4">
                <div className="min-w-0">
                  <label htmlFor="manager_bulk_upload_enabled" className="block font-medium text-white">Manager Bulk Upload</label>
                  <p className="text-xs text-white/50 mt-0.5">Managers can bulk upload events (their account only).</p>
                </div>
                <label htmlFor="manager_bulk_upload_enabled" className="flex items-center gap-2 cursor-pointer flex-shrink-0">
                  <input
                    type="checkbox"
                    id="manager_bulk_upload_enabled"
                    checked={managerBulkUploadEnabled}
                    onChange={(e) => { const v = e.target.checked; setManagerBulkUploadEnabled(v); updateManagerBulkUploadEnabledMutation.mutate(v) }}
                    className="h-4 w-4 text-primary focus:ring-primary border-white/[0.15] rounded"
                  />
                  <span className="text-sm text-white/75">{managerBulkUploadEnabled ? 'On' : 'Off'}</span>
                </label>
              </div>
            </AdminSettingsSection>

            <AdminSettingsSection
              title="Tax Rates"
              open={settingsTaxRatesOpen}
              onToggle={() => setSettingsTaxRatesOpen((v) => !v)}
            >
              <TaxRatesManagement />
            </AdminSettingsSection>
          </div>
        </div>
      )}

      {activeTab === 'city-leads' && (
        <div id="panel-city-leads" role="tabpanel" aria-labelledby="tab-city-leads" className="space-y-6">
          <AdminCityLeadApplications />
        </div>
      )}

      {activeTab === 'yauga-token' && (
        <div id="panel-yauga-token" role="tabpanel" aria-labelledby="tab-yauga-token" className="space-y-6">
          <AdminYaugaTokenPanel />
        </div>
      )}

      {activeTab === 'users' && (
        <div id="panel-users" role="tabpanel" aria-labelledby="tab-users" className="space-y-6">
          {renderUsersSubNav()}
          <div className="bg-[#0B0B0D] rounded-xl shadow-sm p-6 border border-white/[0.12]">
            <div className="mb-4 flex flex-wrap items-baseline justify-between gap-2">
              <h2 className="text-2xl font-semibold text-white">User Management</h2>
              <p className="text-xs text-white/45">
                <span className="font-semibold text-white/70">A</span> Admin
                <span className="mx-1.5 text-white/25">·</span>
                <span className="font-semibold text-white/70">P</span> Practitioner
                <span className="mx-1.5 text-white/25">·</span>
                <span className="font-semibold text-white/70">M</span> Manager
              </p>
            </div>
            <div className="mb-4 flex flex-col gap-3 sm:flex-row sm:flex-wrap sm:items-center">
              <label htmlFor="admin-user-filter" className="sr-only">
                Filter users by name or email
              </label>
              <input
                id="admin-user-filter"
                type="search"
                value={userFilter}
                onChange={(e) => setUserFilter(e.target.value)}
                placeholder="Filter by name or email…"
                className="haus-input w-full max-w-md px-4 py-2 text-sm border border-white/[0.15] rounded-lg focus:ring-2 focus:ring-primary"
              />
              <div className="flex flex-wrap gap-1.5" role="group" aria-label="Filter by role">
                {(
                  [
                    { id: 'all', label: 'All' },
                    { id: 'admin', label: 'Admin' },
                    { id: 'manager', label: 'Manager' },
                    { id: 'practitioner', label: 'Practitioner' },
                  ] as const
                ).map((role) => {
                  const selected = userRoleFilter === role.id
                  return (
                    <button
                      key={role.id}
                      type="button"
                      aria-pressed={selected}
                      onClick={() => setUserRoleFilter(role.id)}
                      className={`min-h-[36px] rounded-lg px-3 py-1.5 text-sm font-medium ${
                        selected
                          ? 'bg-[#8B5CF6]/25 text-white border border-[#8B5CF6]/50'
                          : 'border border-white/[0.15] text-white/65 hover:text-white hover:bg-white/[0.04]'
                      }`}
                    >
                      {role.label}
                    </button>
                  )
                })}
              </div>
            </div>
            {userProfiles.length === 0 ? (
              <p className="text-white/50 text-center py-8">No users found.</p>
            ) : filteredUserProfiles.length === 0 ? (
              <p className="text-white/50 text-center py-8">No users match that name, email, or role.</p>
            ) : (
              <div className="overflow-x-auto pb-8">
                <table className="min-w-full divide-y divide-white/[0.12]">
                  <thead className="bg-[#070707]">
                    <tr>
                      <th className="px-6 py-3 text-left text-xs font-medium text-white/50 uppercase tracking-wider">
                        User
                      </th>
                      <th className="px-6 py-3 text-left text-xs font-medium text-white/50 uppercase tracking-wider">
                        Last Login
                      </th>
                      <th className="px-6 py-3 text-center text-xs font-medium text-white/50 uppercase tracking-wider">
                        Bookings
                      </th>
                      <th className="px-6 py-3 text-left text-xs font-medium text-white/50 uppercase tracking-wider">
                        Roles
                      </th>
                      <th className="px-6 py-3 text-left text-xs font-medium text-white/50 uppercase tracking-wider">
                        Actions
                      </th>
                    </tr>
                  </thead>
                  <tbody className="bg-[#0B0B0D] divide-y divide-white/[0.12]">
                    {filteredUserProfiles.map((profile) => {
                      const manager = managers.find(m => m.email === profile.email)
                      const audit = adminAuditByEmail.get(profile.email.toLowerCase())
                      const lastLogin = profile.last_login_at || audit?.last_sign_in_at || null
                      const paidBookings = audit?.paid_bookings_count ?? 0
                      const bookingsCount = audit?.bookings_count ?? paidBookings
                      const eligibleForDeletion = !!audit?.inactive_90d && paidBookings === 0 && !profile.is_admin && !profile.is_practitioner && !manager
                      return (
                        <tr key={profile.id}>
                          <td className="px-6 py-4 text-sm text-white">
                            {profile.name?.trim() ? (
                              <div className="flex flex-col gap-0.5">
                                <span className="font-medium whitespace-nowrap">{profile.name.trim()}</span>
                                <span className="text-white/65 whitespace-nowrap">{profile.email}</span>
                              </div>
                            ) : (
                              <span className="whitespace-nowrap">{profile.email}</span>
                            )}
                          </td>
                          <td className="px-6 py-4 whitespace-nowrap text-sm text-white/75">
                            {lastLogin
                              ? new Date(lastLogin).toLocaleString('en-GB', {
                                  day: 'numeric',
                                  month: 'short',
                                  year: 'numeric',
                                  hour: '2-digit',
                                  minute: '2-digit',
                                  hour12: false,
                                })
                              : 'Never'}
                          </td>
                          <td className="px-6 py-4 whitespace-nowrap text-center text-sm text-white/75">
                            {bookingsCount}
                          </td>
                          <td className="px-6 py-4 text-sm">
                            {(profile.is_admin || profile.is_practitioner || manager) ? (
                              <div className="flex flex-col gap-1.5">
                                <div className="flex flex-wrap gap-1.5">
                                  {profile.is_admin && (
                                    <span className="px-2 py-0.5 rounded-full text-xs font-medium bg-[#8B5CF6]/25 text-[#E9D5FF] border border-[#8B5CF6]/40">
                                      Admin
                                    </span>
                                  )}
                                  {profile.is_practitioner && (
                                    <span className="px-2 py-0.5 rounded-full text-xs font-medium bg-emerald-500/20 text-emerald-200 border border-emerald-400/35">
                                      Practitioner
                                    </span>
                                  )}
                                  {manager && (
                                    <span className="px-2 py-0.5 rounded-full text-xs font-medium bg-sky-500/20 text-sky-200 border border-sky-400/35">
                                      Manager ({manager.commission_percentage}%)
                                    </span>
                                  )}
                                </div>
                                {manager?.end_date && (
                                  <span className="text-xs text-white/65">
                                    Contract ends: {new Date(manager.end_date).toLocaleDateString('en-GB', {
                                      day: 'numeric',
                                      month: 'short',
                                      year: 'numeric'
                                    })}
                                  </span>
                                )}
                                {manager && manager.territory_type !== 'open' && manager.territory_value && (
                                  <span className="text-xs text-white/50">
                                    {manager.territory_type}: {manager.territory_value}
                                  </span>
                                )}
                              </div>
                            ) : null}
                          </td>
                          <td className="px-6 py-4 text-sm">
                            <div className="flex flex-wrap items-center gap-2">
                              <div
                                className="inline-flex items-stretch overflow-hidden rounded-lg border border-white/[0.14] divide-x divide-white/[0.12]"
                                role="group"
                                aria-label="Assign roles"
                              >
                                <UserRoleLetterButton
                                  letter="A"
                                  actionLabel={profile.is_admin ? 'Remove Admin' : 'Make Admin'}
                                  active={profile.is_admin}
                                  activeClassName="bg-[#8B5CF6]/30 text-[#E9D5FF]"
                                  onClick={() => {
                                    setConfirmModal({
                                      show: true,
                                      title: profile.is_admin ? 'Remove Admin Status' : 'Grant Admin Status',
                                      message: `Are you sure you want to ${profile.is_admin ? 'remove admin status from' : 'grant admin status to'} ${profile.email}?`,
                                      confirmText: profile.is_admin ? 'Remove Admin' : 'Grant Admin',
                                      cancelText: 'Cancel',
                                      confirmButtonClass: profile.is_admin ? 'bg-red-500 hover:bg-red-600' : 'btn-haus-fill focus-visible:ring-[#A78BFA]',
                                      onConfirm: () => {
                                        userProfilesApi.updateAdminStatus(profile.email, !profile.is_admin)
                                          .then(() => {
                                            queryClient.invalidateQueries({ queryKey: ['user-profiles'] })
                                            toast.success(`Admin status ${profile.is_admin ? 'removed' : 'granted'} successfully!`)
                                            setConfirmModal(null)
                                          })
                                          .catch((error: any) => {
                                            toast.error(`Failed to update admin status: ${error.message || 'Unknown error'}`)
                                            setConfirmModal(null)
                                          })
                                      },
                                    })
                                  }}
                                />
                                <UserRoleLetterButton
                                  letter="P"
                                  actionLabel={profile.is_practitioner ? 'Remove Practitioner' : 'Make Practitioner'}
                                  active={profile.is_practitioner === true}
                                  activeClassName="bg-emerald-500/25 text-emerald-200"
                                  onClick={() => {
                                    setConfirmModal({
                                      show: true,
                                      title: profile.is_practitioner ? 'Remove Practitioner Status' : 'Grant Practitioner Status',
                                      message: `Are you sure you want to ${profile.is_practitioner ? 'remove practitioner status from' : 'grant practitioner status to'} ${profile.email}?`,
                                      confirmText: profile.is_practitioner ? 'Remove Practitioner' : 'Make Practitioner',
                                      cancelText: 'Cancel',
                                      confirmButtonClass: profile.is_practitioner ? 'bg-red-500 hover:bg-red-600' : 'btn-haus-fill focus-visible:ring-[#A78BFA]',
                                      onConfirm: () => {
                                        userProfilesApi.updatePractitionerStatus(profile.email, !profile.is_practitioner)
                                          .then(() => {
                                            queryClient.invalidateQueries({ queryKey: ['user-profiles'] })
                                            queryClient.invalidateQueries({ queryKey: ['user-profile'] })
                                            queryClient.invalidateQueries({ queryKey: ['meditation-practitioners'] })
                                            toast.success(`Practitioner status ${profile.is_practitioner ? 'removed' : 'granted'} successfully!`)
                                            setConfirmModal(null)
                                          })
                                          .catch((error: any) => {
                                            toast.error(`Failed to update practitioner status: ${error.message || 'Unknown error'}`)
                                            setConfirmModal(null)
                                          })
                                      },
                                    })
                                  }}
                                />
                                <UserRoleLetterButton
                                  letter="M"
                                  actionLabel={manager ? 'Remove Manager' : 'Make Manager'}
                                  active={!!manager}
                                  activeClassName="bg-sky-500/25 text-sky-200"
                                  onClick={() => {
                                    if (manager) {
                                      setConfirmModal({
                                        show: true,
                                        title: 'Remove Manager Status',
                                        message: `Are you sure you want to remove manager status from ${profile.email}?`,
                                        confirmText: 'Remove Manager',
                                        cancelText: 'Cancel',
                                        confirmButtonClass: 'bg-red-500 hover:bg-red-600',
                                        onConfirm: () => {
                                          managersApi.delete(manager.id)
                                            .then(() => {
                                              queryClient.invalidateQueries({ queryKey: ['managers'] })
                                              toast.success('Manager status removed successfully!')
                                              setConfirmModal(null)
                                            })
                                            .catch((error: any) => {
                                              toast.error(`Failed to remove manager: ${error.message || 'Unknown error'}`)
                                              setConfirmModal(null)
                                            })
                                        },
                                      })
                                      return
                                    }
                                    setSelectedUserForManager(profile)
                                    setManagerFormData({
                                      commission_percentage: 25.00,
                                      territory_type: 'open',
                                      territory_value: '',
                                      contract_end_date: '',
                                    })
                                    setShowManagerModal(true)
                                  }}
                                />
                              </div>
                            {eligibleForDeletion && (
                              <button
                                type="button"
                                onClick={() => {
                                  setConfirmModal({
                                    show: true,
                                    title: 'Delete User',
                                    message: `Delete ${profile.email}? This is only allowed for users with zero paid bookings and no login for 90+ days.`,
                                    confirmText: 'Delete User',
                                    cancelText: 'Cancel',
                                    confirmButtonClass: 'bg-red-500 hover:bg-red-600',
                                    onConfirm: () => {
                                      deleteUserMutation.mutate(profile.email)
                                      setConfirmModal(null)
                                    },
                                  })
                                }}
                                disabled={isDeletingUser}
                                className="px-3 py-1.5 rounded-lg text-xs font-medium bg-red-500 text-white hover:bg-red-600 disabled:opacity-50"
                              >
                                Delete User
                              </button>
                            )}
                            </div>
                          </td>
                        </tr>
                      )
                    })}
                  </tbody>
                </table>
              </div>
            )}
          </div>
        </div>
      )}

      {/* Bulk Upload Events Modal */}
      {showBulkUploadModal && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-black bg-opacity-50 p-4"
          onMouseDown={(e) => {
            if (e.target === e.currentTarget) {
              setShowBulkUploadModal(false)
              setBulkUploadFile(null)
              setBulkUploadIsProcessing(false)
              setBulkUploadResults([])
              setBulkUploadProgress(null)
            }
          }}
        >
          <div
            ref={bulkUploadDialog.dialogRef}
            role="dialog"
            aria-modal="true"
            aria-labelledby="admin-bulk-upload-title"
            aria-describedby="admin-bulk-upload-desc"
            tabIndex={-1}
            onKeyDown={bulkUploadDialog.onKeyDown}
            className="bg-[#0B0B0D] rounded-xl shadow-xl max-w-3xl w-full max-h-[90vh] overflow-y-auto focus:outline-none"
          >
            <div className="p-6">
              <div className="flex justify-between items-center mb-4">
                <h2 id="admin-bulk-upload-title" className="text-2xl font-bold text-white">Bulk Upload Events</h2>
                <button
                  onClick={() => {
                    setShowBulkUploadModal(false)
                    setBulkUploadFile(null)
                    setBulkUploadIsProcessing(false)
                    setBulkUploadResults([])
                    setBulkUploadProgress(null)
                  }}
                  className="text-white/40 hover:text-white/65 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary focus-visible:ring-offset-2 rounded"
                  aria-label="Close bulk upload dialog"
                >
                  <svg className="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                  </svg>
                </button>
              </div>

              <div className="space-y-4">
                <p id="admin-bulk-upload-desc" className="text-white/65">
                  <strong>Note:</strong> The template downloads as <strong>CSV (Excel-compatible)</strong>. Open it in Excel,
                  fill in your events, then save as CSV and upload it here. The system will validate each row, geocode missing
                  latitude/longitude, and create events under your admin account (<strong>{userEmail}</strong>).
                </p>

                <div className="flex flex-col sm:flex-row gap-3 sm:items-center sm:justify-between bg-[#070707] border border-white/[0.12] rounded-lg p-4">
                  <div>
                    <div className="font-medium text-white">1) Download template</div>
                    <div className="text-sm text-white/65">Includes required columns and an example row.</div>
                  </div>
                  <button
                    id="bulk-upload-download-template"
                    type="button"
                    onClick={downloadBulkUploadTemplateCsv}
                    className="bg-[#0B0B0D] text-white/90 px-4 py-2 rounded-lg font-medium border border-white/[0.15] hover:bg-[#070707]"
                  >
                    Download Template (CSV)
                  </button>
                </div>

                <div className="bg-[#070707] border border-white/[0.12] rounded-lg p-4 space-y-3">
                  <div>
                    <div className="font-medium text-white">2) Upload your completed CSV</div>
                    <div className="text-sm text-white/65">We will validate each row before inserting.</div>
                  </div>
                  <input
                    type="file"
                    accept=".csv,text/csv"
                    onChange={(e) => setBulkUploadFile(e.target.files?.[0] || null)}
                    className="block w-full text-sm text-white/75 file:mr-4 file:rounded-lg file:border file:border-[#8B5CF6]/45 file:bg-[#050505] file:px-4 file:py-2 file:text-sm file:font-semibold file:text-white file:shadow-[0_0_14px_rgba(139,92,246,0.28)] file:ring-1 file:ring-inset file:ring-[#8B5CF6]/25 hover:file:border-[#8B5CF6]/60 hover:file:bg-[#121212]"
                    disabled={bulkUploadIsProcessing}
                  />
                  {bulkUploadFile && (
                    <div className="text-xs text-white/65">
                      Selected: <span className="font-medium">{bulkUploadFile.name}</span>
                    </div>
                  )}
                  <div className="flex gap-2">
                    <button
                      type="button"
                      onClick={handleBulkUploadEvents}
                      disabled={!bulkUploadFile || bulkUploadIsProcessing}
                      className="btn-haus-fill rounded-lg px-4 py-2 disabled:opacity-50 disabled:cursor-not-allowed"
                    >
                      {bulkUploadIsProcessing ? 'Uploading...' : 'Upload Events'}
                    </button>
                    <button
                      type="button"
                      onClick={() => {
                        setBulkUploadFile(null)
                        setBulkUploadResults([])
                        setBulkUploadProgress(null)
                      }}
                      disabled={bulkUploadIsProcessing}
                      className="btn-haus-outline rounded-lg px-4 py-2 disabled:opacity-50"
                    >
                      Reset
                    </button>
                  </div>
                  {bulkUploadProgress && (
                    <div className="text-sm text-white/75">
                      Processing row {bulkUploadProgress.current} of {bulkUploadProgress.total}...
                    </div>
                  )}
                </div>

                {bulkUploadResults.length > 0 && (
                  <div className="border border-white/[0.12] rounded-lg overflow-hidden">
                    <div className="bg-[#070707] px-4 py-3 flex items-center justify-between">
                      <div className="font-medium text-white">Upload Results</div>
                      <div className="text-sm text-white/65">
                        <span className="mr-3">
                          Success: <strong>{bulkUploadResults.filter(r => r.status === 'success').length}</strong>
                        </span>
                        <span>
                          Errors: <strong>{bulkUploadResults.filter(r => r.status === 'error').length}</strong>
                        </span>
                      </div>
                    </div>
                    <div className="max-h-80 overflow-y-auto">
                      <table className="min-w-full divide-y divide-white/[0.12]">
                        <thead className="bg-[#0B0B0D] sticky top-0">
                          <tr>
                            <th className="px-4 py-2 text-left text-xs font-medium text-white/50 uppercase">Row</th>
                            <th className="px-4 py-2 text-left text-xs font-medium text-white/50 uppercase">Event</th>
                            <th className="px-4 py-2 text-left text-xs font-medium text-white/50 uppercase">Status</th>
                            <th className="px-4 py-2 text-left text-xs font-medium text-white/50 uppercase">Message</th>
                          </tr>
                        </thead>
                        <tbody className="bg-[#0B0B0D] divide-y divide-white/[0.12]">
                          {bulkUploadResults.map((r) => (
                            <tr key={`${r.row}-${r.status}-${r.eventName || ''}`}>
                              <td className="px-4 py-2 text-sm text-white/75">{r.row}</td>
                              <td className="px-4 py-2 text-sm text-white">{r.eventName || 'ÔÇö'}</td>
                              <td className="px-4 py-2 text-sm">
                                <span
                                  className={`px-2 py-1 rounded-full text-xs font-medium ${
                                    r.status === 'success'
                                      ? 'bg-violet-100 text-violet-800'
                                      : r.status === 'error'
                                        ? 'bg-red-100 text-red-800'
                                        : 'bg-white/[0.08] text-white/75'
                                  }`}
                                >
                                  {r.status}
                                </span>
                              </td>
                              <td className="px-4 py-2 text-sm text-white/75">{r.message}</td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                  </div>
                )}
              </div>
            </div>
          </div>
        </div>
      )}

      {promoteEvent && (
        <AdminPromoteModal
          event={promoteEvent}
          promotions={eventPromotions.filter((row) => row.event_id === promoteEvent.id)}
          onClose={() => setPromoteEvent(null)}
        />
      )}

      {/* Checklist Completion Modal */}
      {showChecklistModal && eventToOpen && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-black bg-opacity-50 p-4"
          onMouseDown={(e) => {
            if (e.target === e.currentTarget) checklistDialog.onKeyDown({ key: 'Escape', preventDefault: () => {}, } as any)
          }}
        >
          <div
            ref={checklistDialog.dialogRef}
            role="dialog"
            aria-modal="true"
            aria-labelledby="admin-checklist-title"
            aria-describedby="admin-checklist-desc"
            tabIndex={-1}
            onKeyDown={checklistDialog.onKeyDown}
            className="bg-[#0B0B0D] rounded-xl shadow-xl max-w-2xl w-full max-h-[90vh] overflow-y-auto focus:outline-none"
          >
            <div className="p-6">
              <div className="flex justify-between items-center mb-4">
                <h2 id="admin-checklist-title" className="text-2xl font-bold text-white">Complete Event Checklist</h2>
                <button
                  onClick={() => {
                    setShowChecklistModal(false)
                    setEventToOpen(null)
                    setChecklistCheckedItems(new Set())
                  }}
                  className="text-white/40 hover:text-white/65 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary focus-visible:ring-offset-2 rounded"
                  aria-label="Close checklist dialog"
                >
                  <svg className="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                  </svg>
                </button>
              </div>
              <p id="admin-checklist-desc" className="text-white/65 mb-6">
                Please complete all checklist items before opening the event: <strong>{eventToOpen.name}</strong>
              </p>
              <div className="space-y-3 mb-6">
                {checklistItems.map((item) => (
                  <label key={item.id} className="flex items-start gap-3 p-4 border border-white/[0.12] rounded-lg hover:bg-[#070707] cursor-pointer">
                    <input
                      type="checkbox"
                      checked={checklistCheckedItems.has(item.id)}
                      onChange={(e) => {
                        const newChecked = new Set(checklistCheckedItems)
                        if (e.target.checked) {
                          newChecked.add(item.id)
                        } else {
                          newChecked.delete(item.id)
                        }
                        setChecklistCheckedItems(newChecked)
                      }}
                      className="mt-1 w-5 h-5 text-primary border-white/[0.15] rounded focus:ring-primary"
                    />
                    <span className="flex-1 text-white">{item.item_text}</span>
                  </label>
                ))}
              </div>
              <div className="flex gap-3">
                <button
                  onClick={async () => {
                    if (checklistCheckedItems.size !== checklistItems.length) {
                      toast.error('Please complete all checklist items before opening the event.')
                      return
                    }
                    try {
                      // If hybrid, require hybrid link, details and price
                      if (eventToOpen.event_type === 'hybrid') {
                        const hybridLink = (eventToOpen.hybrid_link ?? '').toString().trim()
                        const hybridDetails = (eventToOpen.hybrid_details ?? '').toString().trim()
                        const hybridPriceSet = eventToOpen.hybrid_price_pence != null && typeof eventToOpen.hybrid_price_pence === 'number'
                        if (!hybridLink || !hybridDetails || !hybridPriceSet) {
                          const missing: string[] = []
                          if (!hybridLink) missing.push('Hybrid link')
                          if (!hybridDetails) missing.push('Hybrid details')
                          if (!hybridPriceSet) missing.push('Hybrid price')
                          toast.error(
                            `Hybrid events require: ${missing.join(', ')}. Please complete these before opening.`,
                            { duration: 5000 }
                          )
                          return
                        }
                      }
                      // Validate venue details are populated (required for opening)
                      const locationParts = parseLocation(eventToOpen.location)
                      const missingFields: string[] = []
                      
                      if (!locationParts.venueName || locationParts.venueName.trim() === '') {
                        missingFields.push('Venue Name')
                      }
                      if (!locationParts.addressLine1 || locationParts.addressLine1.trim() === '') {
                        missingFields.push('Address Line 1')
                      }
                      if (!locationParts.townCity || locationParts.townCity.trim() === '') {
                        missingFields.push('Town/City')
                      }
                      if (!locationParts.postcode || locationParts.postcode.trim() === '') {
                        missingFields.push('Postcode')
                      }
                      
                      if (missingFields.length > 0) {
                        toast.error(
                          `Please populate the following venue fields before opening the event: ${missingFields.join(', ')}`,
                          { duration: 5000 }
                        )
                        return
                      }
                      
                      // Complete checklist
                      await completeChecklistMutation.mutateAsync({
                        eventId: eventToOpen.id,
                        checkedItems: Array.from(checklistCheckedItems),
                      })
                      setShowChecklistModal(false)
                      setChecklistCheckedItems(new Set())
                      // Show early incentive prompt, then open
                      setEventPendingOpen(eventToOpen)
                      setEventToOpen(null)
                      setEarlyIncentiveStep('prompt')
                      setShowEarlyIncentiveModal(true)
                      toast.success('Checklist completed! Choose whether to add an early booking incentive.')
                    } catch (error: any) {
                      toast.error(`Failed to complete checklist: ${error.message || 'Unknown error'}`)
                    }
                  }}
                  disabled={completeChecklistMutation.isPending || openEventMutation.isPending}
                  className="btn-haus-fill flex-1 rounded-lg px-6 py-3 disabled:cursor-not-allowed disabled:opacity-50"
                >
                  {completeChecklistMutation.isPending || openEventMutation.isPending
                    ? 'Processing...'
                    : 'Complete Checklist & Open Event'}
                </button>
                <button
                  onClick={() => {
                    setShowChecklistModal(false)
                    setEventToOpen(null)
                    setChecklistCheckedItems(new Set())
                  }}
                  className="btn-haus-outline flex-1 rounded-lg px-6 py-3"
                >
                  Cancel
                </button>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* Early Booking Incentive Modal */}
      {showEarlyIncentiveModal && eventPendingOpen && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-black bg-opacity-50 p-4"
          onMouseDown={(e) => {
            if (e.target === e.currentTarget) {
              setShowEarlyIncentiveModal(false)
              setEventPendingOpen(null)
              setEarlyIncentiveStep('prompt')
              setEarlyIncentiveForm({ numberOfBookings: '', discountPercent: '' })
            }
          }}
        >
          <div
            role="dialog"
            aria-modal="true"
            aria-labelledby="early-incentive-title"
            className="bg-[#0B0B0D] rounded-xl shadow-xl max-w-md w-full p-6 focus:outline-none"
          >
            <h2 id="early-incentive-title" className="text-xl font-bold text-white mb-4">
              {earlyIncentiveStep === 'prompt' ? 'Early booking incentive' : 'Early booking incentive details'}
            </h2>
            {earlyIncentiveStep === 'prompt' ? (
              <>
                <p className="text-white/65 mb-6">
                  Do you want to add an early booking incentive for <strong>{eventPendingOpen.name}</strong>? 
                </p>
                <div className="flex gap-3">
                  <button
                    type="button"
                    onClick={() => {
                      setShowEarlyIncentiveModal(false)
                      const id = eventPendingOpen.id
                      setEventPendingOpen(null)
                      setEarlyIncentiveStep('prompt')
                      openEventMutation.mutate(id)
                    }}
                    disabled={openEventMutation.isPending}
                    className="btn-haus-outline flex-1 rounded-lg px-4 py-3 disabled:opacity-50"
                  >
                    No
                  </button>
                  <button
                    type="button"
                    onClick={() => setEarlyIncentiveStep('form')}
                    className="btn-haus-fill flex-1 rounded-lg px-4 py-3"
                  >
                    Yes
                  </button>
                </div>
              </>
            ) : (
              <>
                <p className="text-white/65 mb-4">How many bookings get the discount, and what discount %?</p>
                <div className="space-y-4 mb-6">
                  <div>
                    <label className="block text-sm font-medium text-white/75 mb-1">Number of bookings</label>
                    <input
                      type="number"
                      min={1}
                      value={earlyIncentiveForm.numberOfBookings}
                      onChange={(e) => setEarlyIncentiveForm((p) => ({ ...p, numberOfBookings: e.target.value }))}
                      className="w-full px-3 py-2 border border-white/[0.15] rounded-lg focus:ring-2 focus:ring-primary"
                      placeholder="e.g. 20"
                    />
                  </div>
                  <div>
                    <label className="block text-sm font-medium text-white/75 mb-1">Discount (%)</label>
                    <input
                      type="number"
                      min={1}
                      max={100}
                      value={earlyIncentiveForm.discountPercent}
                      onChange={(e) => setEarlyIncentiveForm((p) => ({ ...p, discountPercent: e.target.value }))}
                      className="w-full px-3 py-2 border border-white/[0.15] rounded-lg focus:ring-2 focus:ring-primary"
                      placeholder="e.g. 10"
                    />
                  </div>
                </div>
                <div className="flex gap-3">
                  <button
                    type="button"
                    onClick={() => {
                      setEarlyIncentiveStep('prompt')
                      setEarlyIncentiveForm({ numberOfBookings: '', discountPercent: '' })
                    }}
                    className="btn-haus-outline flex-1 rounded-lg px-4 py-3"
                  >
                    Back
                  </button>
                  <button
                    type="button"
                    onClick={async () => {
                      const num = parseInt(earlyIncentiveForm.numberOfBookings, 10)
                      const pct = parseInt(earlyIncentiveForm.discountPercent, 10)
                      if (!Number.isFinite(num) || num < 1) {
                        toast.error('Please enter a valid number of bookings (at least 1).')
                        return
                      }
                      if (!Number.isFinite(pct) || pct < 1 || pct > 100) {
                        toast.error('Please enter a discount between 1 and 100.')
                        return
                      }
                      const code = randomEarlyIncentiveCode8()
                      const now = new Date()
                      const startIso = new Date(now.getFullYear(), now.getMonth(), now.getDate()).toISOString().slice(0, 10)
                      const eventDate = eventPendingOpen.event_date ? new Date(eventPendingOpen.event_date) : null
                      const endDate = eventDate && eventDate.getTime() > now.getTime()
                        ? eventDate.toISOString().slice(0, 10)
                        : new Date(now.getFullYear() + 1, now.getMonth(), now.getDate()).toISOString().slice(0, 10)
                      let createdCode = code
                      try {
                        await adminDiscountCodesApi.create({
                          code,
                          event_id: eventPendingOpen.id,
                          quantity: num,
                          start_date: startIso,
                          end_date: endDate,
                          discount_percent: pct,
                        })
                      } catch (e: any) {
                        const msg = String(e?.message || '')
                        if (msg.toLowerCase().includes('duplicate') || msg.toLowerCase().includes('unique')) {
                          const altCode = randomEarlyIncentiveCode8()
                          await adminDiscountCodesApi.create({
                            code: altCode,
                            event_id: eventPendingOpen.id,
                            quantity: num,
                            start_date: startIso,
                            end_date: endDate,
                            discount_percent: pct,
                          })
                          createdCode = altCode
                        } else {
                          toast.error(e?.message || 'Failed to create discount code')
                          return
                        }
                      }
                      const id = eventPendingOpen.id
                      setShowEarlyIncentiveModal(false)
                      setEventPendingOpen(null)
                      setEarlyIncentiveStep('prompt')
                      setEarlyIncentiveForm({ numberOfBookings: '', discountPercent: '' })
                      openEventMutation.mutate({
                        eventId: id,
                        earlyBookingIncentive: { numberOfBookings: num, discountPercent: pct, code: createdCode },
                      })
                    }}
                    disabled={openEventMutation.isPending}
                    className="btn-haus-fill flex-1 rounded-lg px-4 py-3 disabled:opacity-50"
                  >
                    {openEventMutation.isPending ? 'Opening…' : 'Continue & Open Event'}
                  </button>
                </div>
              </>
            )}
          </div>
        </div>
      )}

      {/* Reassign Manager Modal */}
      {showReassignModal && eventToReassign && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black bg-opacity-50 p-4">
          <div className="bg-[#0B0B0D] rounded-xl shadow-xl max-w-md w-full">
            <div className="p-6">
              <h2 className="text-2xl font-bold text-white mb-4">Reassign Manager</h2>
              <p className="text-white/65 mb-4">
                Select a new manager for <strong>{eventToReassign.name}</strong>
              </p>
              
              <div className="mb-4">
                <label className="flex items-center gap-2 mb-2">
                  <input
                    type="checkbox"
                    checked={reassignAllEvents}
                    onChange={(e) => setReassignAllEvents(e.target.checked)}
                    className="rounded border-white/[0.15] text-primary focus:ring-primary"
                  />
                  <span className="text-sm text-white/75">
                    Reassign all events currently managed by <strong>{eventToReassign.admin_email}</strong>
                  </span>
                </label>
              </div>

              <div className="mb-6 max-h-64 overflow-y-auto border border-white/[0.12] rounded-lg">
                {managers.length === 0 ? (
                  <p className="text-white/50 text-center py-4">No managers available</p>
                ) : (
                  <div className="divide-y divide-white/[0.12]">
                    {managers.map((manager) => (
                      <button
                        key={manager.id}
                        onClick={async () => {
                          const newManagerEmail = manager.email
                          const oldManagerEmail = eventToReassign.admin_email
                          
                          if (newManagerEmail === oldManagerEmail) {
                            toast.error('This manager is already assigned to this event')
                            return
                          }

                          try {
                            const updatePromise = reassignAllEvents
                              ? supabase
                                  .from('events')
                                  .update({ admin_email: newManagerEmail })
                                  .eq('admin_email', oldManagerEmail)
                              : supabase
                                  .from('events')
                                  .update({ admin_email: newManagerEmail })
                                  .eq('id', eventToReassign.id)

                            const { error } = await updatePromise
                            if (error) throw error
                            
                            toast.success(
                              reassignAllEvents
                                ? `All events reassigned to ${manager.manager_name || manager.email}`
                                : `Event reassigned to ${manager.manager_name || manager.email}`
                            )
                            queryClient.invalidateQueries({ queryKey: ['admin-events'] })
                            setShowReassignModal(false)
                            setEventToReassign(null)
                          } catch (error: any) {
                            toast.error(`Failed to reassign manager: ${error.message || 'Unknown error'}`)
                          }
                        }}
                        className="w-full text-left px-4 py-3 hover:bg-[#070707] transition-colors"
                      >
                        <div className="flex justify-between items-center">
                          <div>
                            <p className="font-medium text-white">
                              {manager.manager_name || manager.email}
                            </p>
                            <p className="text-sm text-white/50">{manager.email}</p>
                            {manager.territory_type && (
                              <p className="text-xs text-white/40">
                                {manager.territory_type}: {manager.territory_value}
                              </p>
                            )}
                          </div>
                          <div className="text-right">
                            <p className="text-sm font-medium text-primary">
                              {manager.commission_percentage}%
                            </p>
                          </div>
                        </div>
                      </button>
                    ))}
                  </div>
                )}
              </div>

              <div className="flex gap-3">
                <button
                  onClick={() => {
                    setShowReassignModal(false)
                    setEventToReassign(null)
                    setReassignAllEvents(false)
                  }}
                  className="btn-haus-outline flex-1 rounded-lg px-6 py-3"
                >
                  Cancel
                </button>
              </div>
            </div>
          </div>
        </div>
      )}

      {renderConfirmModal()}
      {renderTestBookingDeleteModal()}
      {renderRegenerateEventModal()}

      {/* Manager Assignment Modal */}
      {showManagerModal && selectedUserForManager && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-black bg-opacity-50 p-4"
          onMouseDown={(e) => {
            if (e.target === e.currentTarget) {
              setShowManagerModal(false)
              setSelectedUserForManager(null)
            }
          }}
        >
          <div
            ref={managerDialog.dialogRef}
            role="dialog"
            aria-modal="true"
            aria-labelledby="admin-make-manager-title"
            tabIndex={-1}
            onKeyDown={managerDialog.onKeyDown}
            className="bg-[#0B0B0D] rounded-xl shadow-xl max-w-md w-full focus:outline-none"
          >
            <div className="p-6">
              <div className="flex justify-between items-center mb-4">
                <h2 id="admin-make-manager-title" className="text-2xl font-bold text-white">Make Manager</h2>
                <button
                  onClick={() => {
                    setShowManagerModal(false)
                    setSelectedUserForManager(null)
                  }}
                  className="text-white/40 hover:text-white/65 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary focus-visible:ring-offset-2 rounded"
                  aria-label="Close make manager dialog"
                >
                  <svg className="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                  </svg>
                </button>
              </div>
              <p className="text-white/65 mb-4">Assigning manager status to: <strong>{selectedUserForManager.email}</strong></p>
              <form onSubmit={async (e) => {
                e.preventDefault()
                try {
                  if (!managerFormData.contract_end_date) {
                    toast.error('Please select a contract end date')
                    return
                  }
                  
                  const manager = await managersApi.create({
                    user_id: selectedUserForManager.user_id,
                    email: selectedUserForManager.email,
                    commission_percentage: managerFormData.commission_percentage,
                    territory_type: managerFormData.territory_type === 'open' ? null : managerFormData.territory_type,
                    territory_value: managerFormData.territory_type === 'open' ? null : managerFormData.territory_value || null,
                    end_date: managerFormData.contract_end_date,
                  })
                  
                  // Send welcome email (non-blocking)
                  // Note: Function requires admin authorization (JWT)
                  try {
                    const supabaseUrl = import.meta.env.VITE_SUPABASE_URL
                    const session = await authApi.getSessionWithRefresh()
                    if (!session?.access_token) {
                      throw new Error('Not authenticated')
                    }
                    const response = await fetch(`${supabaseUrl}/functions/v1/send-manager-welcome`, {
                      method: 'POST',
                      headers: {
                        'Content-Type': 'application/json',
                        'apikey': import.meta.env.VITE_SUPABASE_ANON_KEY,
                        'Authorization': `Bearer ${session.access_token}`,
                      },
                      body: JSON.stringify({
                        managerEmail: manager.email,
                        managerName: manager.manager_name || manager.email,
                        commissionPercentage: manager.commission_percentage,
                        contractEndDate: manager.end_date,
                      }),
                    })

                    if (!response.ok) {
                      const errorText = await response.text()
                      console.warn('Failed to send welcome email:', errorText)
                      toast.error('Manager created, but failed to send welcome email. Please notify them manually.')
                    }
                  } catch (emailError: any) {
                    console.warn('Error sending welcome email:', emailError)
                    toast.error('Manager created, but failed to send welcome email. Please notify them manually.')
                  }
                  
                  queryClient.invalidateQueries({ queryKey: ['managers'] })
                  toast.success('Manager assigned successfully!')
                  setShowManagerModal(false)
                  setSelectedUserForManager(null)
                } catch (error: any) {
                  toast.error(`Failed to assign manager: ${error.message || 'Unknown error'}`)
                }
              }} className="space-y-4">
                <div>
                  <label htmlFor="commission" className="block text-sm font-medium text-white/75 mb-1">
                    Platform Share Percentage *
                  </label>
                  <input
                    type="number"
                    id="commission"
                    min="0"
                    max="100"
                    step="0.01"
                    value={managerFormData.commission_percentage}
                    onChange={(e) => setManagerFormData({ ...managerFormData, commission_percentage: parseFloat(e.target.value) || 0 })}
                    className="w-full px-4 py-2 border border-white/[0.15] rounded-lg focus:ring-2 focus:ring-primary focus:border-transparent"
                    required
                  />
                  <p className="text-xs text-white/50 mt-1">Default: 25%</p>
                </div>
                <div>
                  <label htmlFor="territory_type" className="block text-sm font-medium text-white/75 mb-1">
                    Territory Type
                  </label>
                  <select
                    id="territory_type"
                    value={managerFormData.territory_type}
                    onChange={(e) => {
                      const newType = e.target.value as 'country' | 'state' | 'city' | 'open'
                      setManagerFormData({ 
                        ...managerFormData, 
                        territory_type: newType,
                        territory_value: newType === 'open' ? '' : managerFormData.territory_value
                      })
                    }}
                    className="w-full px-4 py-2 border border-white/[0.15] rounded-lg focus:ring-2 focus:ring-primary focus:border-transparent"
                  >
                    <option value="open">Open (All Territories)</option>
                    <option value="country">Country</option>
                    <option value="state">State/Province</option>
                    <option value="city">City</option>
                  </select>
                </div>
                {managerFormData.territory_type !== 'open' && (
                  <div>
                    <label htmlFor="territory_value" className="block text-sm font-medium text-white/75 mb-1">
                      Territory Value *
                    </label>
                    <input
                      type="text"
                      id="territory_value"
                      value={managerFormData.territory_value}
                      onChange={(e) => setManagerFormData({ ...managerFormData, territory_value: e.target.value })}
                      className="w-full px-4 py-2 border border-white/[0.15] rounded-lg focus:ring-2 focus:ring-primary focus:border-transparent"
                      placeholder={managerFormData.territory_type === 'country' ? 'e.g. UK, USA' : managerFormData.territory_type === 'state' ? 'e.g. California, London' : 'e.g. London, Manchester'}
                      required={(managerFormData.territory_type as string) !== 'open'}
                    />
                  </div>
                )}
                <div>
                  <label htmlFor="contract_end_date" className="block text-sm font-medium text-white/75 mb-1">
                    Contract End Date *
                  </label>
                  <input
                    type="date"
                    id="contract_end_date"
                    value={managerFormData.contract_end_date}
                    onChange={(e) => setManagerFormData({ ...managerFormData, contract_end_date: e.target.value })}
                    className="w-full px-4 py-2 border border-white/[0.15] rounded-lg focus:ring-2 focus:ring-primary focus:border-transparent"
                    required
                    min={new Date().toISOString().split('T')[0]}
                  />
                  <p className="text-xs text-white/50 mt-1">Select when the manager contract expires</p>
                </div>
                <div className="flex gap-3 pt-4">
                  <button
                    type="submit"
                    className="btn-haus-fill flex-1 rounded-lg px-6 py-3"
                  >
                    Assign Manager
                  </button>
                  <button
                    type="button"
                    onClick={() => {
                      setShowManagerModal(false)
                      setSelectedUserForManager(null)
                    }}
                    className="btn-haus-outline flex-1 rounded-lg px-6 py-3"
                  >
                    Cancel
                  </button>
                </div>
              </form>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}

function TaxRatesManagement() {
  const queryClient = useQueryClient()
  const [editingTaxRate, setEditingTaxRate] = useState<TaxRate | null>(null)
  const [showTaxRateForm, setShowTaxRateForm] = useState(false)
  const [taxRateFormData, setTaxRateFormData] = useState({
    country: '',
    rate: '',
    enabled: true,
    tax_label: '',
    tax_number: '',
    registered_entity_name: '',
    registered_entity_address: '',
    registered_entity_company_number: '',
  })

  const { data: taxRates = [], isLoading } = useQuery({
    queryKey: ['tax-rates'],
    queryFn: () => taxRatesApi.list(),
  })

  const createTaxRateMutation = useMutation({
    mutationFn: (taxRate: {
      country: string
      rate: number
      enabled: boolean
      tax_label?: string | null
      tax_number?: string | null
      registered_entity_name?: string | null
      registered_entity_address?: string | null
      registered_entity_company_number?: string | null
    }) =>
      taxRatesApi.create(taxRate),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['tax-rates'] })
      toast.success('Tax rate created successfully!')
      setShowTaxRateForm(false)
      setTaxRateFormData({
        country: '',
        rate: '',
        enabled: true,
        tax_label: '',
        tax_number: '',
        registered_entity_name: '',
        registered_entity_address: '',
        registered_entity_company_number: '',
      })
    },
    onError: (error: any) => {
      toast.error(`Failed to create tax rate: ${error.message || 'Unknown error'}`)
    },
  })

  const updateTaxRateMutation = useMutation({
    mutationFn: ({ id, updates }: {
      id: string
      updates: {
        country?: string
        rate?: number
        enabled?: boolean
        tax_label?: string | null
        tax_number?: string | null
        registered_entity_name?: string | null
        registered_entity_address?: string | null
        registered_entity_company_number?: string | null
      }
    }) =>
      taxRatesApi.update(id, updates),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['tax-rates'] })
      toast.success('Tax rate updated successfully!')
      setEditingTaxRate(null)
      setShowTaxRateForm(false)
      setTaxRateFormData({
        country: '',
        rate: '',
        enabled: true,
        tax_label: '',
        tax_number: '',
        registered_entity_name: '',
        registered_entity_address: '',
        registered_entity_company_number: '',
      })
    },
    onError: (error: any) => {
      toast.error(`Failed to update tax rate: ${error.message || 'Unknown error'}`)
    },
  })

  const toggleTaxRateMutation = useMutation({
    mutationFn: ({ id, enabled }: { id: string; enabled: boolean }) =>
      taxRatesApi.update(id, { enabled }),
    onSuccess: (_data, variables) => {
      queryClient.invalidateQueries({ queryKey: ['tax-rates'] })
      toast.success(`Tax rate ${variables.enabled ? 'enabled' : 'disabled'} successfully!`)
    },
    onError: (error: any) => {
      toast.error(`Failed to toggle tax rate: ${error.message || 'Unknown error'}`)
    },
  })

  const deleteTaxRateMutation = useMutation({
    mutationFn: (id: string) => taxRatesApi.delete(id),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['tax-rates'] })
      toast.success('Tax rate deleted successfully!')
    },
    onError: (error: any) => {
      toast.error(`Failed to delete tax rate: ${error.message || 'Unknown error'}`)
    },
  })

  const handleTaxRateSubmit = (e: React.FormEvent) => {
    e.preventDefault()
    const rate = parseFloat(taxRateFormData.rate)
    if (isNaN(rate) || rate < 0 || rate > 100) {
      toast.error('Tax rate must be between 0 and 100')
      return
    }

    const tax_label = taxRateFormData.tax_label?.trim() || null
    const tax_number = taxRateFormData.tax_number?.trim() || null
    const registered_entity_name = taxRateFormData.registered_entity_name?.trim() || null
    const registered_entity_address = taxRateFormData.registered_entity_address?.trim() || null
    const registered_entity_company_number = taxRateFormData.registered_entity_company_number?.trim() || null

    if (editingTaxRate) {
      updateTaxRateMutation.mutate({
        id: editingTaxRate.id,
        updates: {
          country: taxRateFormData.country,
          rate,
          enabled: taxRateFormData.enabled,
          tax_label,
          tax_number,
          registered_entity_name,
          registered_entity_address,
          registered_entity_company_number,
        },
      })
    } else {
      createTaxRateMutation.mutate({
        country: taxRateFormData.country,
        rate,
        enabled: taxRateFormData.enabled,
        tax_label,
        tax_number,
        registered_entity_name,
        registered_entity_address,
        registered_entity_company_number,
      })
    }
  }

  const handleEditTaxRate = (taxRate: TaxRate) => {
    setEditingTaxRate(taxRate)
    setTaxRateFormData({
      country: taxRate.country,
      rate: taxRate.rate.toString(),
      enabled: taxRate.enabled,
      tax_label: taxRate.tax_label || '',
      tax_number: taxRate.tax_number || '',
      registered_entity_name: taxRate.registered_entity_name || '',
      registered_entity_address: taxRate.registered_entity_address || '',
      registered_entity_company_number: taxRate.registered_entity_company_number || '',
    })
    setShowTaxRateForm(true)
  }

  const handleCancelTaxRate = () => {
    setEditingTaxRate(null)
    setShowTaxRateForm(false)
    setTaxRateFormData({
      country: '',
      rate: '',
      enabled: true,
      tax_label: '',
      tax_number: '',
      registered_entity_name: '',
      registered_entity_address: '',
      registered_entity_company_number: '',
    })
  }

  return (
    <div className="space-y-4">
      {showTaxRateForm ? (
        <form onSubmit={handleTaxRateSubmit} className="space-y-4 p-4 bg-[#070707] rounded-lg">
          <h3 className="text-lg font-semibold text-white">
            {editingTaxRate ? 'Edit Tax Rate' : 'Add Tax Rate'}
          </h3>
          <div>
            <label className="block text-sm font-medium text-white/75 mb-1">Country *</label>
            <input
              type="text"
              value={taxRateFormData.country}
              onChange={(e) => setTaxRateFormData({ ...taxRateFormData, country: e.target.value })}
              className="w-full px-4 py-2 border border-white/[0.15] rounded-lg focus:ring-2 focus:ring-primary"
              required
              disabled={!!editingTaxRate}
            />
          </div>
          <div>
            <label className="block text-sm font-medium text-white/75 mb-1">Tax Rate (%) *</label>
            <input
              type="number"
              step="0.01"
              min="0"
              max="100"
              value={taxRateFormData.rate}
              onChange={(e) => setTaxRateFormData({ ...taxRateFormData, rate: e.target.value })}
              className="w-full px-4 py-2 border border-white/[0.15] rounded-lg focus:ring-2 focus:ring-primary"
              required
            />
          </div>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <div>
              <label className="block text-sm font-medium text-white/75 mb-1">Tax Label</label>
              <input
                type="text"
                value={taxRateFormData.tax_label}
                onChange={(e) => setTaxRateFormData({ ...taxRateFormData, tax_label: e.target.value })}
                className="w-full px-4 py-2 border border-white/[0.15] rounded-lg focus:ring-2 focus:ring-primary"
                placeholder="e.g. VAT Number:"
              />
            </div>
            <div>
              <label className="block text-sm font-medium text-white/75 mb-1">Tax Number</label>
              <input
                type="text"
                value={taxRateFormData.tax_number}
                onChange={(e) => setTaxRateFormData({ ...taxRateFormData, tax_number: e.target.value })}
                className="w-full px-4 py-2 border border-white/[0.15] rounded-lg focus:ring-2 focus:ring-primary"
                placeholder="e.g. GB123456789"
              />
            </div>
          </div>

          <div className="mt-2">
            <label className="block text-sm font-medium text-white/75 mb-1">Registered Entity Details (optional override)</label>
            <p className="text-xs text-white/50 mb-2">
              If set, these values will be used for receipts/invoices for this country instead of the global Registered Entity Details.
            </p>
            <div className="space-y-3">
              <div>
                <label className="block text-xs font-medium text-white/65 mb-1">Registered Entity Name</label>
                <input
                  type="text"
                  value={taxRateFormData.registered_entity_name}
                  onChange={(e) => setTaxRateFormData({ ...taxRateFormData, registered_entity_name: e.target.value })}
                  className="w-full px-4 py-2 border border-white/[0.15] rounded-lg focus:ring-2 focus:ring-primary"
                  placeholder="e.g. Yauga Haus Ltd"
                />
              </div>
              <div>
                <label className="block text-xs font-medium text-white/65 mb-1">Registered Entity Address</label>
                <textarea
                  value={taxRateFormData.registered_entity_address}
                  onChange={(e) => setTaxRateFormData({ ...taxRateFormData, registered_entity_address: e.target.value })}
                  className="w-full px-4 py-2 border border-white/[0.15] rounded-lg focus:ring-2 focus:ring-primary"
                  placeholder="Street&#10;City&#10;Postcode"
                  rows={3}
                />
              </div>
              <div>
                <label className="block text-xs font-medium text-white/65 mb-1">Company Number</label>
                <input
                  type="text"
                  value={taxRateFormData.registered_entity_company_number}
                  onChange={(e) => setTaxRateFormData({ ...taxRateFormData, registered_entity_company_number: e.target.value })}
                  className="w-full px-4 py-2 border border-white/[0.15] rounded-lg focus:ring-2 focus:ring-primary"
                  placeholder="e.g. 12345678"
                />
              </div>
            </div>
          </div>
          <div className="flex items-center">
            <input
              type="checkbox"
              id="tax_enabled"
              checked={taxRateFormData.enabled}
              onChange={(e) => setTaxRateFormData({ ...taxRateFormData, enabled: e.target.checked })}
              className="w-4 h-4 text-primary border-white/[0.15] rounded focus:ring-primary"
            />
            <label htmlFor="tax_enabled" className="ml-2 text-sm font-medium text-white/75">
              Enable tax calculations for this country
            </label>
          </div>
          <div className="flex gap-2">
            <button
              type="submit"
              disabled={createTaxRateMutation.isPending || updateTaxRateMutation.isPending}
              className="btn-haus-fill rounded-lg px-4 py-2 disabled:opacity-50"
            >
              {createTaxRateMutation.isPending || updateTaxRateMutation.isPending ? 'Saving...' : 'Save'}
            </button>
            <button
              type="button"
              onClick={handleCancelTaxRate}
              className="btn-haus-outline rounded-lg px-4 py-2"
            >
              Cancel
            </button>
          </div>
        </form>
      ) : (
        <div>
          <div className="flex justify-between items-center mb-4">
            <p className="text-sm text-white/65">Manage tax rates for different countries</p>
            <button
              onClick={() => setShowTaxRateForm(true)}
              className="btn-haus-fill rounded-lg px-4 py-2 text-sm"
            >
              Add Tax Rate
            </button>
          </div>
          {isLoading ? (
            <p className="text-white/50">Loading tax rates...</p>
          ) : taxRates.length === 0 ? (
            <p className="text-white/50">No tax rates configured.</p>
          ) : (
            <div className="overflow-x-auto">
              <table className="min-w-full divide-y divide-white/[0.12]">
                <thead className="bg-[#070707]">
                  <tr>
                    <th className="px-4 py-3 text-left text-xs font-medium text-white/50 uppercase">Country</th>
                    <th className="px-4 py-3 text-right text-xs font-medium text-white/50 uppercase">Rate (%)</th>
                    <th className="px-4 py-3 text-left text-xs font-medium text-white/50 uppercase">Tax Details</th>
                    <th className="px-4 py-3 text-center text-xs font-medium text-white/50 uppercase">Enabled</th>
                    <th className="px-4 py-3 text-right text-xs font-medium text-white/50 uppercase">Actions</th>
                  </tr>
                </thead>
                <tbody className="bg-[#0B0B0D] divide-y divide-white/[0.12]">
                  {taxRates.map((taxRate) => (
                    <tr key={taxRate.id} className={!taxRate.enabled ? 'opacity-60' : ''}>
                      <td className="px-4 py-3 text-sm text-white">{taxRate.country}</td>
                      <td className="px-4 py-3 text-sm text-white text-right">{taxRate.rate}%</td>
                      <td className="px-4 py-3 text-sm text-white/75">
                        <div className="space-y-1">
                          {taxRate.tax_number ? (
                            <div>
                              <span className="text-white/65">{taxRate.tax_label || 'Tax Number:'}</span>{' '}
                              <span className="font-medium text-white">{taxRate.tax_number}</span>
                            </div>
                          ) : (
                            <div className="text-white/40">Tax number: ÔÇö</div>
                          )}
                          {(taxRate.registered_entity_name || taxRate.registered_entity_company_number) ? (
                            <div className="text-xs text-white/50">
                              Entity: {taxRate.registered_entity_name || 'ÔÇö'}
                              {taxRate.registered_entity_company_number ? ` (Co. ${taxRate.registered_entity_company_number})` : ''}
                            </div>
                          ) : (
                            <div className="text-xs text-white/40">Entity override: ÔÇö</div>
                          )}
                        </div>
                      </td>
                      <td className="px-4 py-3 text-center">
                        <button
                          onClick={() => toggleTaxRateMutation.mutate({ id: taxRate.id, enabled: !taxRate.enabled })}
                          className={`px-3 py-1 rounded-full text-xs font-medium ${
                            taxRate.enabled
                              ? 'bg-violet-100 text-violet-800 hover:bg-violet-200'
                              : 'bg-white/[0.08] text-white/65 hover:bg-white/[0.1]'
                          }`}
                          disabled={toggleTaxRateMutation.isPending}
                        >
                          {taxRate.enabled ? 'Enabled' : 'Disabled'}
                        </button>
                      </td>
                      <td className="px-4 py-3 text-right">
                        <div className="flex gap-2 justify-end">
                          <button
                            onClick={() => handleEditTaxRate(taxRate)}
                            className="text-blue-600 hover:text-blue-800 text-sm font-medium"
                          >
                            Edit
                          </button>
                          <button
                            onClick={() => {
                              if (confirm(`Are you sure you want to delete the tax rate for ${taxRate.country}?`)) {
                                deleteTaxRateMutation.mutate(taxRate.id)
                              }
                            }}
                            className="text-red-600 hover:text-red-800 text-sm font-medium"
                          >
                            Delete
                          </button>
                        </div>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
      )}
    </div>
  )
}

function AdminSettingsSection({
  title,
  description,
  open,
  onToggle,
  children,
}: {
  title: string
  description?: string
  open: boolean
  onToggle: () => void
  children: React.ReactNode
}) {
  const panelId = `settings-panel-${title.toLowerCase().replace(/\s+/g, '-')}`
  return (
    <div className="bg-[#0B0B0D] rounded-xl border border-white/[0.12] overflow-hidden">
      <button
        type="button"
        onClick={onToggle}
        aria-expanded={open}
        aria-controls={panelId}
        className="w-full flex items-start justify-between gap-3 px-4 py-3 text-left bg-[#070707]/50 hover:bg-[#070707]/80 transition-colors min-h-11"
      >
        <div className="min-w-0">
          <h3 className="text-lg font-semibold text-white">{title}</h3>
          {description ? <p className="text-xs text-white/50 mt-0.5">{description}</p> : null}
        </div>
        <span className="text-white/70 text-lg leading-none flex-shrink-0 mt-0.5" aria-hidden="true">
          {open ? '−' : '+'}
        </span>
      </button>
      <div
        id={panelId}
        role="region"
        hidden={!open}
        className={open ? 'p-4 border-t border-white/[0.12]' : undefined}
      >
        {children}
      </div>
    </div>
  )
}

function WhatsAppGroupsManagement({ enabled = true }: { enabled?: boolean }) {
  const queryClient = useQueryClient()
  const { legalEmail } = useLegalEmail()
  const [editingGroup, setEditingGroup] = useState<WhatsAppGroup | null>(null)
  const [showForm, setShowForm] = useState(false)
  const [geocoding, setGeocoding] = useState(false)
  const [showGeocodeFailModal, setShowGeocodeFailModal] = useState(false)
  const [geocodeFailMessage, setGeocodeFailMessage] = useState('')
  const [search, setSearch] = useState('')
  const [statusFilter, setStatusFilter] = useState<'all' | 'active' | 'inactive'>('all')
  const [page, setPage] = useState(1)
  const formRef = useRef<HTMLFormElement>(null)
  const nameInputRef = useRef<HTMLInputElement>(null)
  const [formData, setFormData] = useState({
    group_name: '',
    group_link: '',
    location: '',
    latitude: '',
    longitude: '',
    is_active: true,
  })

  const geocodeFailDialog = useA11yDialog({
    isOpen: showGeocodeFailModal,
    onClose: () => setShowGeocodeFailModal(false),
    initialFocusSelector: 'button',
  })

  const { data: groups = [], isLoading } = useQuery({
    queryKey: ['whatsapp-groups'],
    queryFn: () => whatsappGroupsApi.list(),
    enabled,
  })

  const pageSize = 15

  const filteredGroups = useMemo(() => {
    const q = search.trim().toLowerCase()
    return groups
      .filter((g) => {
        if (statusFilter === 'active' && !g.is_active) return false
        if (statusFilter === 'inactive' && g.is_active) return false
        if (!q) return true
        return (
          g.group_name.toLowerCase().includes(q) ||
          g.location.toLowerCase().includes(q) ||
          g.group_link.toLowerCase().includes(q)
        )
      })
      .sort((a, b) => {
        const loc = a.location.localeCompare(b.location, undefined, { sensitivity: 'base' })
        if (loc !== 0) return loc
        return a.group_name.localeCompare(b.group_name, undefined, { sensitivity: 'base' })
      })
  }, [groups, search, statusFilter])

  const totalPages = Math.max(1, Math.ceil(filteredGroups.length / pageSize))
  const currentPage = Math.min(page, totalPages)
  const pagedGroups = useMemo(() => {
    const start = (currentPage - 1) * pageSize
    return filteredGroups.slice(start, start + pageSize)
  }, [filteredGroups, currentPage, pageSize])

  useEffect(() => {
    setPage(1)
  }, [search, statusFilter])

  useEffect(() => {
    if (!showForm) return
    formRef.current?.scrollIntoView({ behavior: 'smooth', block: 'start' })
    const t = window.setTimeout(() => nameInputRef.current?.focus(), 80)
    return () => window.clearTimeout(t)
  }, [showForm, editingGroup?.id])

  const createMutation = useMutation({
    mutationFn: (group: Omit<WhatsAppGroup, 'id' | 'created_at' | 'updated_at'>) => whatsappGroupsApi.create(group),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['whatsapp-groups'] })
      toast.success('WhatsApp group created!')
      setShowForm(false)
      setEditingGroup(null)
      setFormData({ group_name: '', group_link: '', location: '', latitude: '', longitude: '', is_active: true })
    },
    onError: (error: any) => toast.error(error.message || 'Failed to create WhatsApp group'),
  })

  const updateMutation = useMutation({
    mutationFn: ({ id, updates }: { id: string; updates: Partial<Omit<WhatsAppGroup, 'id' | 'created_at' | 'updated_at'>> }) =>
      whatsappGroupsApi.update(id, updates),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['whatsapp-groups'] })
      toast.success('WhatsApp group updated!')
      setShowForm(false)
      setEditingGroup(null)
      setFormData({ group_name: '', group_link: '', location: '', latitude: '', longitude: '', is_active: true })
    },
    onError: (error: any) => toast.error(error.message || 'Failed to update WhatsApp group'),
  })

  const deleteMutation = useMutation({
    mutationFn: (id: string) => whatsappGroupsApi.delete(id),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['whatsapp-groups'] })
      toast.success('WhatsApp group deleted!')
    },
    onError: (error: any) => toast.error(error.message || 'Failed to delete WhatsApp group'),
  })

  const geocodeLocationText = async (query: string): Promise<{ lat: number; lng: number } | null> => {
    return geocodeLocation(query, legalEmail)
  }

  // Auto-geocode when location changes
  useEffect(() => {
    if (!showForm) return
    const q = formData.location.trim()
    if (q.length < 3) return
    const timeoutId = setTimeout(async () => {
      setGeocoding(true)
      const coords = await geocodeLocationText(q)
      if (coords) {
        setFormData((prev) => ({
          ...prev,
          latitude: coords.lat.toString(),
          longitude: coords.lng.toString(),
        }))
      }
      setGeocoding(false)
    }, 800)
    return () => clearTimeout(timeoutId)
  }, [formData.location, showForm])

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault()
    const group_name = formData.group_name.trim()
    const group_link = formData.group_link.trim()
    const location = formData.location.trim()
    if (!group_name || !group_link || !location) {
      toast.error('Group name, link, and location are required')
      return
    }
    try {
      // Validate URL shape (WhatsApp invites are typically chat.whatsapp.com)
      // We allow any https URL so the admin can paste wa.me or link shorteners.
      const u = new URL(group_link)
      if (!['http:', 'https:'].includes(u.protocol)) throw new Error('Invalid protocol')
    } catch {
      toast.error('Please enter a valid URL for the group link')
      return
    }

    ;(async () => {
      let latitude = Number(formData.latitude)
      let longitude = Number(formData.longitude)

      // If lat/lng not set (or invalid), attempt to auto-geocode now.
      if (!Number.isFinite(latitude) || !Number.isFinite(longitude)) {
        setGeocoding(true)
        const coords = await geocodeLocationText(location)
        setGeocoding(false)

        if (coords) {
          latitude = coords.lat
          longitude = coords.lng
          setFormData((prev) => ({
            ...prev,
            latitude: coords.lat.toString(),
            longitude: coords.lng.toString(),
          }))
        } else {
          setGeocodeFailMessage(
            `We couldnÔÇÖt find coordinates for ÔÇ£${location}ÔÇØ. Please refine the location (e.g. ÔÇ£London, UKÔÇØ or add a postcode) or enter latitude/longitude manually.`
          )
          setShowGeocodeFailModal(true)
          return
        }
      }

      const payload: Omit<WhatsAppGroup, 'id' | 'created_at' | 'updated_at'> = {
        group_name,
        group_link,
        location,
        latitude,
        longitude,
        is_active: formData.is_active,
      }

      if (editingGroup) {
        updateMutation.mutate({ id: editingGroup.id, updates: payload })
      } else {
        createMutation.mutate(payload)
      }
    })()
  }

  const handleEdit = (g: WhatsAppGroup) => {
    setEditingGroup(g)
    setShowForm(true)
    setFormData({
      group_name: g.group_name,
      group_link: g.group_link,
      location: g.location,
      latitude: g.latitude.toString(),
      longitude: g.longitude.toString(),
      is_active: g.is_active,
    })
  }

  const handleCancel = () => {
    setEditingGroup(null)
    setShowForm(false)
    setFormData({ group_name: '', group_link: '', location: '', latitude: '', longitude: '', is_active: true })
  }

  return (
    <div className="space-y-4">
      {showGeocodeFailModal && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-black bg-opacity-50 p-4"
          onMouseDown={(e) => {
            if (e.target === e.currentTarget) setShowGeocodeFailModal(false)
          }}
        >
          <div
            ref={geocodeFailDialog.dialogRef}
            role="dialog"
            aria-modal="true"
            aria-labelledby="whatsapp-geocode-fail-title"
            aria-describedby="whatsapp-geocode-fail-desc"
            tabIndex={-1}
            onKeyDown={geocodeFailDialog.onKeyDown}
            className="bg-[#0B0B0D] rounded-xl shadow-xl max-w-md w-full focus:outline-none"
          >
            <div className="p-6">
              <div className="flex justify-between items-center mb-3">
                <h2 id="whatsapp-geocode-fail-title" className="text-xl font-bold text-white">CouldnÔÇÖt find location</h2>
                <button
                  onClick={() => setShowGeocodeFailModal(false)}
                  className="text-white/40 hover:text-white/65 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary focus-visible:ring-offset-2 rounded"
                  aria-label="Close geocoding error dialog"
                >
                  <svg className="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                  </svg>
                </button>
              </div>
              <p id="whatsapp-geocode-fail-desc" className="text-white/75">
                {geocodeFailMessage || 'We couldnÔÇÖt find coordinates for that location.'}
              </p>
              <div className="mt-5 flex gap-2">
                <button
                  type="button"
                  onClick={() => setShowGeocodeFailModal(false)}
                  className="btn-haus-fill flex-1 rounded-lg px-4 py-2"
                >
                  OK
                </button>
              </div>
            </div>
          </div>
        </div>
      )}
      {showForm ? (
        <form
          ref={formRef}
          onSubmit={handleSubmit}
          className="scroll-mt-28 space-y-4 p-4 bg-[#070707] rounded-lg border border-white/[0.12]"
        >
          <div className="flex items-center justify-between">
            <h3 className="text-lg font-semibold text-white">
              {editingGroup ? 'Edit WhatsApp Group' : 'Add WhatsApp Group'}
            </h3>
            {geocoding && <span className="text-xs text-white/50">Geocoding locationÔÇª</span>}
          </div>

          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <div className="md:col-span-2">
              <label className="block text-sm font-medium text-white/75 mb-1">Group Name *</label>
              <input
                ref={nameInputRef}
                type="text"
                value={formData.group_name}
                onChange={(e) => setFormData({ ...formData, group_name: e.target.value })}
                className="w-full px-4 py-2 border border-white/[0.15] rounded-lg focus:ring-2 focus:ring-primary"
                placeholder="e.g. London"
                required
              />
            </div>
            <div className="md:col-span-2">
              <label className="block text-sm font-medium text-white/75 mb-1">Group Link *</label>
              <input
                type="url"
                value={formData.group_link}
                onChange={(e) => setFormData({ ...formData, group_link: e.target.value })}
                className="w-full px-4 py-2 border border-white/[0.15] rounded-lg focus:ring-2 focus:ring-primary"
                placeholder="https://chat.whatsapp.com/..."
                required
              />
              <p className="text-xs text-white/50 mt-1">Paste the WhatsApp invite link.</p>
            </div>
            <div className="md:col-span-2">
              <label className="block text-sm font-medium text-white/75 mb-1">Location *</label>
              <input
                type="text"
                value={formData.location}
                onChange={(e) => setFormData({ ...formData, location: e.target.value })}
                className="w-full px-4 py-2 border border-white/[0.15] rounded-lg focus:ring-2 focus:ring-primary"
                placeholder="e.g. London, United Kingdom"
                required
              />
              <p className="text-xs text-white/50 mt-1">This will auto-fill latitude and longitude.</p>
            </div>
            <div>
              <label className="block text-sm font-medium text-white/75 mb-1">Latitude *</label>
              <input
                type="number"
                step="any"
                value={formData.latitude}
                onChange={(e) => setFormData({ ...formData, latitude: e.target.value })}
                className="w-full px-4 py-2 border border-white/[0.15] rounded-lg focus:ring-2 focus:ring-primary"
                required
              />
            </div>
            <div>
              <label className="block text-sm font-medium text-white/75 mb-1">Longitude *</label>
              <input
                type="number"
                step="any"
                value={formData.longitude}
                onChange={(e) => setFormData({ ...formData, longitude: e.target.value })}
                className="w-full px-4 py-2 border border-white/[0.15] rounded-lg focus:ring-2 focus:ring-primary"
                required
              />
            </div>
            <div className="md:col-span-2 flex items-center gap-2">
              <input
                type="checkbox"
                id="whatsapp_is_active"
                checked={formData.is_active}
                onChange={(e) => setFormData({ ...formData, is_active: e.target.checked })}
                className="h-4 w-4 text-primary focus:ring-primary border-white/[0.15] rounded"
              />
              <label htmlFor="whatsapp_is_active" className="text-sm font-medium text-white/75">
                Active (shown to users)
              </label>
            </div>
          </div>

          <div className="flex gap-2">
            <button
              type="submit"
              disabled={createMutation.isPending || updateMutation.isPending}
              className="btn-haus-fill rounded-lg px-4 py-2 disabled:opacity-50"
            >
              {createMutation.isPending || updateMutation.isPending ? 'Saving...' : 'Save'}
            </button>
            <button
              type="button"
              onClick={handleCancel}
              className="btn-haus-outline rounded-lg px-4 py-2"
            >
              Cancel
            </button>
          </div>
        </form>
      ) : null}
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <p className="text-sm text-white/65">
          {isLoading
            ? 'Add and manage WhatsApp groups by location.'
            : `${filteredGroups.length} of ${groups.length} group${groups.length === 1 ? '' : 's'}`}
        </p>
        {!showForm ? (
          <button
            type="button"
            onClick={() => setShowForm(true)}
            className="btn-haus-fill rounded-lg px-4 py-2 text-sm self-start sm:self-auto"
          >
            Add WhatsApp Group
          </button>
        ) : null}
      </div>

      {groups.length > 0 ? (
        <div className="flex flex-col gap-3 sm:flex-row sm:items-center">
          <label htmlFor="whatsapp-group-search" className="sr-only">
            Search WhatsApp groups
          </label>
          <input
            id="whatsapp-group-search"
            type="search"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Filter by city, group name, or link…"
            className="haus-input w-full sm:flex-1 px-4 py-2 text-sm border border-white/[0.15] rounded-lg focus:ring-2 focus:ring-primary"
          />
          <label htmlFor="whatsapp-group-status" className="sr-only">
            Filter by status
          </label>
          <select
            id="whatsapp-group-status"
            value={statusFilter}
            onChange={(e) => setStatusFilter(e.target.value as 'all' | 'active' | 'inactive')}
            className="w-full sm:w-44 px-4 py-2 text-sm border border-white/[0.15] rounded-lg bg-[#0B0B0D] text-white focus:ring-2 focus:ring-primary"
          >
            <option value="all">All statuses</option>
            <option value="active">Active</option>
            <option value="inactive">Inactive</option>
          </select>
        </div>
      ) : null}

      {isLoading ? (
        <p className="text-white/50">Loading WhatsApp groups...</p>
      ) : groups.length === 0 ? (
        <div className="bg-[#070707] rounded-lg p-4 border border-white/[0.12] text-center">
          <p className="text-white/50">No WhatsApp groups configured.</p>
        </div>
      ) : filteredGroups.length === 0 ? (
        <div className="bg-[#070707] rounded-lg p-4 border border-white/[0.12] text-center">
          <p className="text-white/50">No groups match that filter.</p>
        </div>
      ) : (
        <>
        <div className="overflow-x-auto border border-white/[0.12] rounded-lg">
          <table className="min-w-full divide-y divide-white/[0.12]">
            <thead className="bg-[#070707]">
              <tr>
                <th className="px-4 py-3 text-left text-xs font-medium text-white/50 uppercase">Group</th>
                <th className="px-4 py-3 text-left text-xs font-medium text-white/50 uppercase">Location</th>
                <th className="px-4 py-3 text-center text-xs font-medium text-white/50 uppercase">Active</th>
                <th className="px-4 py-3 text-right text-xs font-medium text-white/50 uppercase">Actions</th>
              </tr>
            </thead>
            <tbody className="bg-[#0B0B0D] divide-y divide-white/[0.12]">
              {pagedGroups.map((g) => (
                <tr
                  key={g.id}
                  className={`${!g.is_active ? 'opacity-60' : ''} ${
                    editingGroup?.id === g.id ? 'bg-[#8B5CF6]/10' : ''
                  }`}
                >
                  <td className="px-4 py-3 text-sm text-white">
                    <div className="font-medium">{g.group_name}</div>
                    <a href={g.group_link} target="_blank" rel="noreferrer" className="text-xs text-primary hover:underline break-all">
                      {g.group_link}
                    </a>
                  </td>
                  <td className="px-4 py-3 text-sm text-white/75">
                    <div>{g.location}</div>
                    <div className="text-xs text-white/50">
                      {g.latitude.toFixed(5)}, {g.longitude.toFixed(5)}
                    </div>
                  </td>
                  <td className="px-4 py-3 text-center">
                    <span className={`px-2 py-1 rounded-full text-xs font-medium ${g.is_active ? 'bg-violet-100 text-violet-800' : 'bg-white/[0.08] text-white/75'}`}>
                      {g.is_active ? 'Active' : 'Inactive'}
                    </span>
                  </td>
                  <td className="px-4 py-3 text-right">
                    <div className="flex gap-2 justify-end">
                      <button
                        type="button"
                        onClick={() => handleEdit(g)}
                        className="text-blue-600 hover:text-blue-800 text-sm font-medium"
                      >
                        Edit
                      </button>
                      <button
                        type="button"
                        onClick={() => {
                          if (confirm(`Delete WhatsApp group "${g.group_name}"?`)) {
                            deleteMutation.mutate(g.id)
                          }
                        }}
                        className="text-red-600 hover:text-red-800 text-sm font-medium"
                        disabled={deleteMutation.isPending}
                      >
                        Delete
                      </button>
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <ListPagination
          currentPage={currentPage}
          totalPages={totalPages}
          onPageChange={setPage}
          totalItems={filteredGroups.length}
          itemsPerPage={pageSize}
          itemLabel="groups"
        />
        </>
      )}
    </div>
  )
}

function EventDetailsModal({
  eventId,
  eventName,
  onClose,
}: {
  eventId: string
  eventName: string
  onClose: () => void
}) {
  const { data: tickets, isLoading } = useQuery({
    queryKey: ['event-tickets', eventId],
    queryFn: () => ticketsApi.listByEventId(eventId),
    enabled: !!eventId,
  })

  const totalRevenue = tickets?.reduce((sum, t) => sum + t.price_pence, 0) || 0

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black bg-opacity-50 p-4">
      <div className="bg-[#0B0B0D] rounded-xl shadow-xl max-w-4xl w-full max-h-[90vh] overflow-hidden flex flex-col">
        <div className="p-6 border-b border-white/[0.12] flex justify-between items-center">
          <div>
            <h2 className="text-2xl font-semibold text-white">{eventName}</h2>
            <p className="text-sm font-mono text-[#C4B5FD] mt-1 select-all">Event ID: {eventId}</p>
          </div>
          <button
            type="button"
            onClick={onClose}
            aria-label="Close"
            className="text-white/40 hover:text-white/65 text-2xl font-bold"
          >
            ×
          </button>
        </div>
        
        <div className="flex-1 overflow-y-auto p-6">
          {isLoading ? (
            <div className="text-center py-8">
              <p className="text-white/50">Loading ticket details...</p>
            </div>
          ) : !tickets || tickets.length === 0 ? (
            <div className="text-center py-8">
              <p className="text-white/50">No tickets found for this event.</p>
            </div>
          ) : (
            <div className="space-y-4">
              {/* Summary */}
              <div className="bg-[#070707] rounded-lg p-4 border border-white/[0.12]">
                <div className="grid grid-cols-3 gap-4">
                  <div>
                    <p className="text-sm text-white/65">Total Tickets</p>
                    <p className="text-xl font-semibold text-white">{tickets.length}</p>
                  </div>
                  <div>
                    <p className="text-sm text-white/65">Total Revenue</p>
                    <p className="text-xl font-semibold text-primary">
                      £{(totalRevenue / 100).toLocaleString('en-GB', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
                    </p>
                  </div>
                  <div>
                    <p className="text-sm text-white/65">Average Ticket Price</p>
                    <p className="text-xl font-semibold text-white">
                      £{((totalRevenue / tickets.length) / 100).toLocaleString('en-GB', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
                    </p>
                  </div>
                </div>
              </div>

              {/* Tickets Table */}
              <div className="overflow-x-auto">
                <table className="min-w-full divide-y divide-white/[0.12]">
                  <thead className="bg-[#070707]">
                    <tr>
                      <th className="px-4 py-3 text-left text-xs font-medium text-white/50 uppercase">Purchaser Name</th>
                      <th className="px-4 py-3 text-left text-xs font-medium text-white/50 uppercase">Member Email</th>
                      <th className="px-4 py-3 text-left text-xs font-medium text-white/50 uppercase">Transaction Date</th>
                      <th className="px-4 py-3 text-right text-xs font-medium text-white/50 uppercase">Price</th>
                      <th className="px-4 py-3 text-left text-xs font-medium text-white/50 uppercase">Status</th>
                    </tr>
                  </thead>
                  <tbody className="bg-[#0B0B0D] divide-y divide-white/[0.12]">
                    {tickets.map((ticket) => (
                      <tr key={ticket.id} className="hover:bg-[#070707]">
                        <td className="px-4 py-3 text-sm text-white">{ticket.purchaser_name || 'N/A'}</td>
                        <td className="px-4 py-3 text-sm text-white/65">{ticket.member_email}</td>
                        <td className="px-4 py-3 text-sm text-white/65">
                          {ticket.transaction_date 
                            ? new Date(ticket.transaction_date).toLocaleDateString('en-GB', {
                                year: 'numeric',
                                month: 'short',
                                day: 'numeric',
                                hour: '2-digit',
                                minute: '2-digit'
                              })
                            : 'N/A'}
                        </td>
                        <td className="px-4 py-3 text-sm text-white text-right">
                          £{(ticket.price_pence / 100).toLocaleString('en-GB', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
                        </td>
                        <td className="px-4 py-3 text-sm">
                          <span className={`px-2 py-1 rounded-full text-xs font-medium ${
                            ticket.status === 'booked' 
                              ? 'bg-violet-100 text-violet-800'
                              : ticket.status === 'cancelled'
                              ? 'bg-red-100 text-red-800'
                              : 'bg-white/[0.08] text-white/90'
                          }`}>
                            {ticket.status}
                          </span>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                  <tfoot className="bg-[#070707]">
                    <tr>
                      <td colSpan={3} className="px-4 py-3 text-sm font-semibold text-white text-right">
                        Total:
                      </td>
                      <td className="px-4 py-3 text-sm font-semibold text-primary text-right">
                        £{(totalRevenue / 100).toLocaleString('en-GB', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
                      </td>
                      <td></td>
                    </tr>
                  </tfoot>
                </table>
              </div>
            </div>
          )}
        </div>
        
        <div className="p-6 border-t border-white/[0.12] flex justify-end">
          <button
            onClick={onClose}
            className="btn-haus-outline px-6 py-2 rounded-lg"
          >
            Close
          </button>
        </div>
      </div>
    </div>
  )
}

function MonthDetailsModal({
  monthKey,
  onClose,
}: {
  monthKey: string
  onClose: () => void
}) {
  const [year, month] = monthKey.split('-').map(Number)
  const monthName = new Date(year, month).toLocaleString('default', { month: 'long', year: 'numeric' })

  const { data: tickets, isLoading: loadingTickets } = useQuery({
    queryKey: ['month-tickets', year, month],
    queryFn: () => ticketsApi.listByMonth(year, month),
    enabled: !!year && month !== undefined,
  })

  const { data: shopOrders = [], isLoading: loadingShop } = useQuery({
    queryKey: ['month-shop-orders-admin', year, month],
    queryFn: async () => {
      const startOfMonth = new Date(year, month, 1).toISOString()
      const endOfMonth = new Date(year, month + 1, 0, 23, 59, 59).toISOString()
      const { data, error } = await supabase
        .from('shop_orders')
        .select('id, order_number, total_pence, currency, customer_email, created_at')
        .eq('status', 'paid')
        .gte('created_at', startOfMonth)
        .lte('created_at', endOfMonth)
        .order('created_at', { ascending: false })
      if (error) throw error
      return data || []
    },
    enabled: !!year && month !== undefined && !isNaN(year) && !isNaN(month),
  })

  const isLoading = loadingTickets || loadingShop
  const ticketList = tickets || []
  const totalTicketRevenue = ticketList.reduce((sum, t) => sum + t.price_pence, 0)
  const totalShopRevenue = shopOrders.reduce((sum, o) => sum + Number(o.total_pence || 0), 0)

  // Get event details for tickets
  const eventIds = [...new Set(ticketList.map(t => t.event_id))]
  const { data: events } = useQuery({
    queryKey: ['events-for-tickets', eventIds],
    queryFn: async () => {
      if (eventIds.length === 0) return []
      const { data, error } = await supabase
        .from('events')
        .select('id, name')
        .in('id', eventIds)
      if (error) throw error
      return data || []
    },
    enabled: eventIds.length > 0,
  })

  const eventMap = new Map(events?.map(e => [e.id, e.name]) || [])

  if (!monthKey || isNaN(year) || isNaN(month)) {
    console.error('Invalid monthKey:', monthKey)
    return null
  }

  return (
    <div 
      className="fixed inset-0 z-[9999] flex items-center justify-center bg-black bg-opacity-50 p-4"
      onClick={(e) => {
        if (e.target === e.currentTarget) {
          onClose()
        }
      }}
    >
      <div className="bg-[#0B0B0D] rounded-xl shadow-xl max-w-4xl w-full max-h-[90vh] overflow-hidden flex flex-col">
        <div className="p-6 border-b border-white/[0.12] flex justify-between items-center">
          <div>
            <h2 className="text-2xl font-semibold text-white">Revenue Details - {monthName}</h2>
            <p className="text-sm text-white/65 mt-1">Ticket and shop sales in this calendar month</p>
          </div>
          <button
            type="button"
            onClick={onClose}
            aria-label="Close"
            className="text-white/40 hover:text-white/65 text-2xl font-bold"
          >
            ×
          </button>
        </div>
        
        <div className="flex-1 overflow-y-auto p-6">
          {isLoading ? (
            <div className="text-center py-8">
              <p className="text-white/50">Loading revenue details...</p>
            </div>
          ) : ticketList.length === 0 && shopOrders.length === 0 ? (
            <div className="text-center py-8">
              <p className="text-white/50">No ticket or shop sales found for this month.</p>
            </div>
          ) : (
            <div className="space-y-6">
              {/* Summary */}
              <div className="bg-[#070707] rounded-lg p-4 border border-white/[0.12]">
                <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
                  <div>
                    <p className="text-sm text-white/65">Tickets sold</p>
                    <p className="text-xl font-semibold text-white">{ticketList.length}</p>
                    <p className="text-xs text-white/50 mt-1">
                      £{(totalTicketRevenue / 100).toLocaleString('en-GB', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
                    </p>
                  </div>
                  <div>
                    <p className="text-sm text-white/65">Shop orders</p>
                    <p className="text-xl font-semibold text-white">{shopOrders.length}</p>
                    <p className="text-xs text-white/50 mt-1">
                      £{(totalShopRevenue / 100).toLocaleString('en-GB', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
                    </p>
                  </div>
                  <div className="md:col-span-2">
                    <p className="text-sm text-white/65">Combined gross</p>
                    <p className="text-xl font-semibold text-primary">
                      £{((totalTicketRevenue + totalShopRevenue) / 100).toLocaleString('en-GB', {
                        minimumFractionDigits: 2,
                        maximumFractionDigits: 2,
                      })}
                    </p>
                    {ticketList.length > 0 && (
                      <p className="text-xs text-white/50 mt-1">
                        Avg ticket: £
                        {((totalTicketRevenue / ticketList.length) / 100).toLocaleString('en-GB', {
                          minimumFractionDigits: 2,
                          maximumFractionDigits: 2,
                        })}
                      </p>
                    )}
                  </div>
                </div>
              </div>

              {ticketList.length > 0 && (
              <div className="space-y-3">
                <h3 className="text-base font-semibold text-white">Tickets</h3>
              <div className="overflow-x-auto">
                <table className="min-w-full divide-y divide-white/[0.12]">
                  <thead className="bg-[#070707]">
                    <tr>
                      <th className="px-4 py-3 text-left text-xs font-medium text-white/50 uppercase">Event</th>
                      <th className="px-4 py-3 text-left text-xs font-medium text-white/50 uppercase">Purchaser Name</th>
                      <th className="px-4 py-3 text-left text-xs font-medium text-white/50 uppercase">Member Email</th>
                      <th className="px-4 py-3 text-left text-xs font-medium text-white/50 uppercase">Transaction Date</th>
                      <th className="px-4 py-3 text-right text-xs font-medium text-white/50 uppercase">Price</th>
                      <th className="px-4 py-3 text-left text-xs font-medium text-white/50 uppercase">Status</th>
                    </tr>
                  </thead>
                  <tbody className="bg-[#0B0B0D] divide-y divide-white/[0.12]">
                    {ticketList.map((ticket) => (
                      <tr key={ticket.id} className="hover:bg-[#070707]">
                        <td className="px-4 py-3 text-sm text-white">{eventMap.get(ticket.event_id) || 'Unknown Event'}</td>
                        <td className="px-4 py-3 text-sm text-white">{ticket.purchaser_name || 'N/A'}</td>
                        <td className="px-4 py-3 text-sm text-white/65">{ticket.member_email}</td>
                        <td className="px-4 py-3 text-sm text-white/65">
                          {ticket.transaction_date 
                            ? new Date(ticket.transaction_date).toLocaleDateString('en-GB', {
                                year: 'numeric',
                                month: 'short',
                                day: 'numeric',
                                hour: '2-digit',
                                minute: '2-digit'
                              })
                            : 'N/A'}
                        </td>
                        <td className="px-4 py-3 text-sm text-white text-right">
                          £{(ticket.price_pence / 100).toLocaleString('en-GB', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
                        </td>
                        <td className="px-4 py-3 text-sm">
                          <span className={`px-2 py-1 rounded-full text-xs font-medium ${
                            ticket.status === 'booked' 
                              ? 'bg-violet-100 text-violet-800'
                              : ticket.status === 'cancelled'
                              ? 'bg-red-100 text-red-800'
                              : 'bg-white/[0.08] text-white/90'
                          }`}>
                            {ticket.status}
                          </span>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                  <tfoot className="bg-[#070707]">
                    <tr>
                      <td colSpan={4} className="px-4 py-3 text-sm font-semibold text-white text-right">
                        Total:
                      </td>
                      <td className="px-4 py-3 text-sm font-semibold text-primary text-right">
                        £{(totalTicketRevenue / 100).toLocaleString('en-GB', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
                      </td>
                      <td></td>
                    </tr>
                  </tfoot>
                </table>
              </div>
              </div>
              )}

              {shopOrders.length > 0 && (
                <div className="space-y-3">
                  <h3 className="text-base font-semibold text-white">Shop orders</h3>
                  <div className="overflow-x-auto">
                    <table className="min-w-full divide-y divide-white/[0.12]">
                      <thead className="bg-[#070707]">
                        <tr>
                          <th className="px-4 py-3 text-left text-xs font-medium text-white/50 uppercase">Order</th>
                          <th className="px-4 py-3 text-left text-xs font-medium text-white/50 uppercase">Customer</th>
                          <th className="px-4 py-3 text-left text-xs font-medium text-white/50 uppercase">Date</th>
                          <th className="px-4 py-3 text-right text-xs font-medium text-white/50 uppercase">Total</th>
                        </tr>
                      </thead>
                      <tbody className="bg-[#0B0B0D] divide-y divide-white/[0.12]">
                        {shopOrders.map((o) => {
                          const ref =
                            o.order_number != null && Number.isFinite(Number(o.order_number))
                              ? `YH-${Number(o.order_number)}`
                              : String(o.id).slice(0, 8) + '…'
                          const sym = o.currency === 'USD' ? '$' : '£'
                          return (
                            <tr key={o.id} className="hover:bg-[#070707]">
                              <td className="px-4 py-3 text-sm text-white font-medium">{ref}</td>
                              <td className="px-4 py-3 text-sm text-white/65">{o.customer_email || '-'}</td>
                              <td className="px-4 py-3 text-sm text-white/65">
                                {o.created_at
                                  ? new Date(o.created_at).toLocaleDateString('en-GB', {
                                      year: 'numeric',
                                      month: 'short',
                                      day: 'numeric',
                                      hour: '2-digit',
                                      minute: '2-digit',
                                    })
                                  : '-'}
                              </td>
                              <td className="px-4 py-3 text-sm text-white text-right">
                                {sym}
                                {(Number(o.total_pence || 0) / 100).toLocaleString('en-GB', {
                                  minimumFractionDigits: 2,
                                  maximumFractionDigits: 2,
                                })}
                              </td>
                            </tr>
                          )
                        })}
                      </tbody>
                      <tfoot className="bg-[#070707]">
                        <tr>
                          <td colSpan={3} className="px-4 py-3 text-sm font-semibold text-white text-right">
                            Total:
                          </td>
                          <td className="px-4 py-3 text-sm font-semibold text-primary text-right">
                            £
                            {(totalShopRevenue / 100).toLocaleString('en-GB', {
                              minimumFractionDigits: 2,
                              maximumFractionDigits: 2,
                            })}
                          </td>
                        </tr>
                      </tfoot>
                    </table>
                  </div>
                </div>
              )}
            </div>
          )}
        </div>
        
        <div className="p-6 border-t border-white/[0.12] flex justify-end">
          <button
            onClick={onClose}
            className="btn-haus-outline px-6 py-2 rounded-lg"
          >
            Close
          </button>
        </div>
      </div>
    </div>
  )
}

function UserRoleLetterButton({
  letter,
  actionLabel,
  active,
  activeClassName,
  onClick,
}: {
  letter: string
  actionLabel: string
  active: boolean
  activeClassName: string
  onClick: () => void
}) {
  return (
    <button
      type="button"
      aria-label={actionLabel}
      aria-pressed={active}
      onClick={onClick}
      className={`group relative min-w-[2.25rem] px-2.5 py-1.5 text-xs font-semibold tracking-wide transition duration-200 focus-visible:z-10 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[#A78BFA] ${
        active
          ? activeClassName
          : 'text-white/45 hover:bg-white/[0.06] hover:text-white'
      }`}
    >
      {letter}
      <span className="pointer-events-none absolute left-1/2 top-full z-30 mt-1.5 -translate-x-1/2 whitespace-nowrap rounded-md border border-white/[0.14] bg-[#121212] px-2 py-1 text-[10px] font-medium text-white opacity-0 shadow-lg transition-opacity group-hover:opacity-100 group-focus-visible:opacity-100">
        {actionLabel}
      </span>
    </button>
  )
}

function EventAdminTableRow({
  event,
  isSelected,
  onSelect,
  onEdit,
  onUpdate,
  onOpen,
  onDelete,
  onReassignManager,
  onRegenerate,
  promotions = [],
  onPromote,
}: {
  event: Event
  isSelected?: boolean
  onSelect: () => void
  onEdit: () => void
  onUpdate: (updates: Partial<Event>) => void
  onOpen: () => void
  onDelete: () => void
  onReassignManager?: () => void
  onRegenerate: () => void
  promotions?: PromotionRecord[]
  onPromote: () => void
}) {
  const statusColors: Record<string, string> = {
    draft: 'bg-white/[0.08] text-white/90',
    collecting_interest: 'bg-sky-500/25 text-sky-200 border border-sky-400/35',
    open: 'bg-emerald-500/20 text-emerald-200 border border-emerald-400/35',
    closed: 'bg-red-500/25 text-red-200 border border-red-400/35',
    completed: 'bg-white/[0.08] text-white/90',
    sold_out: 'bg-amber-500/25 text-amber-200 border border-amber-400/35',
  }

  const { brandName } = useBrandName()
  const canCheckIn = isAdminEventCheckInButtonVisible(event)

  const handlePrintAttendees = async (e: React.MouseEvent) => {
    e.stopPropagation()
    try {
      const tickets = await adminApi.getEventTickets(event.id)
      const booked = tickets
        .filter((t) => t.status === 'booked')
        .sort((a, b) => new Date(a.transaction_date).getTime() - new Date(b.transaction_date).getTime())
      if (booked.length === 0) {
        toast.error('No registered attendees yet')
        return
      }
      printEventAttendeeList({ event, attendees: booked, brandName })
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : 'Failed to load attendees'
      toast.error(message)
    }
  }

  const regOrBookings = event.bookings_count ?? event.registration_count
  const isTargetMet = regOrBookings >= event.min_target

  const bookingsLabel =
    event.status === 'open' || event.status === 'closed' || event.status === 'completed'
      ? String(regOrBookings)
      : `${event.registration_count} / ${event.min_target}`

  return (
    <tr
      className={`cursor-pointer border-b border-white/[0.08] transition-colors last:border-b-0 ${
        isSelected ? 'bg-[#8B5CF6]/12' : 'hover:bg-white/[0.04]'
      } ${event.status === 'completed' ? 'opacity-60 grayscale' : ''} ${
        isTargetMet && event.status !== 'completed' ? 'border-l-4 border-l-emerald-500' : ''
      }`}
      onClick={onSelect}
    >
      <td className="py-3 pl-4 pr-2 align-top">
        <div className="flex items-start justify-between gap-2">
          <div className="font-semibold text-white min-w-0 flex-1 break-words" title={event.id}>
            {event.name}
          </div>
          <div className="flex flex-col gap-1 shrink-0">
            <button
              type="button"
              onClick={(e) => {
                e.stopPropagation()
                const url = `${window.location.origin}/events/${event.id}`
                navigator.clipboard.writeText(url).then(
                  () => toast.success('Event link copied to clipboard'),
                  () => toast.error('Could not copy link')
                )
              }}
              className="btn-haus-fill rounded-lg px-2.5 py-1 text-[11px]"
              title="Copy direct link to share this event"
            >
              Link
            </button>
            <button
              type="button"
              onClick={(e) => {
                e.stopPropagation()
                onRegenerate()
              }}
              className="btn-haus-outline rounded-lg px-2.5 py-1 text-[11px]"
              title="Resend confirmation emails with updated event details to all confirmed bookings"
            >
              Regenerate
            </button>
          </div>
        </div>
        <div className="mt-1 flex flex-wrap items-center gap-1">
          {event.is_featured && (
            <span
              className="inline-flex rounded-full px-2 py-0.5 text-[10px] font-medium bg-[#8B5CF6]/25 text-[#E9D5FF] border border-[#8B5CF6]/40"
              title="Featured on homepage"
            >
              Featured
            </span>
          )}
          {event.is_hidden && (
            <span
              className="inline-flex rounded-full px-2 py-0.5 text-[10px] font-medium bg-amber-500/20 text-amber-200 border border-amber-400/35"
              title="Hidden from public"
            >
              Hidden
            </span>
          )}
          <span
            className={`inline-flex rounded-full px-2 py-0.5 text-[10px] font-medium ${statusColors[event.status]}`}
          >
            {event.status.replace('_', ' ')}
          </span>
          {promotions.map((row) => (
            <span
              key={row.id}
              className="inline-flex rounded-full px-2 py-0.5 text-[10px] font-medium bg-white/[0.08] text-white/80"
              title={row.last_error || row.platform}
            >
              {row.platform === 'eventbrite' ? 'Eventbrite' : 'Luma'}{' '}
              {row.status === 'live' && row.public_url ? (
                <a className="underline ml-1" href={row.public_url} target="_blank" rel="noreferrer" onClick={(e) => e.stopPropagation()}>
                  Live
                </a>
              ) : row.status === 'live' ? (
                ' Live'
              ) : row.status === 'failed' ? (
                ' Failed'
              ) : row.status === 'publishing' ? (
                ' Publishing'
              ) : row.status === 'unpublished' ? (
                ' Unpublished'
              ) : (
                ' Not promoted'
              )}
            </span>
          ))}
        </div>
        <p className="mt-1 text-[10px] font-mono text-[#C4B5FD]/90 select-all truncate" title={event.id}>
          {event.id}
        </p>
      </td>
      <td className="py-3 pr-3 align-top text-white/75">
        <p className="whitespace-nowrap">
          {[
            event.city?.trim() || null,
            event.event_date
              ? new Date(event.event_date).toLocaleDateString('en-GB', {
                  weekday: 'short',
                  day: 'numeric',
                  month: 'short',
                  year: 'numeric',
                })
              : null,
          ]
            .filter(Boolean)
            .join(', ') || '-'}
        </p>
        <p className="mt-0.5 whitespace-nowrap text-white/50">
          £{(event.price_pence / 100).toFixed(2)}
        </p>
      </td>
      <td className="py-3 pr-3 align-top whitespace-nowrap text-white/75">
        {bookingsLabel}
      </td>
      <td className="py-3 pr-4 pl-2 align-top text-right min-w-[22rem] w-[30%]" onClick={(e) => e.stopPropagation()}>
        <div className="flex flex-col items-end gap-2">
          <div className="flex flex-wrap justify-end gap-2">
            {canCheckIn && event.status !== 'completed' && (
              <div className="flex flex-col gap-1">
                <button
                  type="button"
                  onClick={(e) => {
                    e.stopPropagation()
                    // Admin is too large to unmount in-place; same pattern as Leave admin.
                    window.location.assign(`/checkin/${event.id}`)
                  }}
                  className="btn-haus-fill rounded-lg px-2.5 py-1.5 text-xs"
                  title="Check-In"
                >
                  Check-In
                </button>
                <button
                  type="button"
                  onClick={handlePrintAttendees}
                  className="btn-haus-outline rounded-lg px-2.5 py-1.5 text-xs"
                  title="Print registered attendee list (name, email, date registered)"
                >
                  Attendees
                </button>
              </div>
            )}
            {event.status !== 'completed' && (
              <>
                <button
                  type="button"
                  onClick={(e) => {
                    e.stopPropagation()
                    onEdit()
                  }}
                  className="btn-haus-fill rounded-lg px-2.5 py-1.5 text-xs"
                  title="Edit"
                >
                  Edit
                </button>
                <button
                  type="button"
                  onClick={(e) => {
                    e.stopPropagation()
                    onPromote()
                  }}
                  disabled={!canPromoteEvent(event)}
                  className="btn-haus-outline rounded-lg px-2.5 py-1.5 text-xs disabled:opacity-40"
                  title={canPromoteEvent(event) ? 'Promote on Eventbrite or Luma' : 'Open the event and set a date before promoting'}
                >
                  Promote
                </button>
                {event.status === 'collecting_interest' && (
                  <button
                    type="button"
                    onClick={(e) => {
                      e.stopPropagation()
                      onOpen()
                    }}
                    className="bg-[#7C3AED] text-white px-2.5 py-1.5 rounded-lg text-xs font-medium hover:bg-[#6D28D9] ring-1 ring-white/10"
                    title="Open Event"
                  >
                    Open
                  </button>
                )}
                {onReassignManager && (
                  <button
                    type="button"
                    onClick={(e) => {
                      e.stopPropagation()
                      onReassignManager()
                    }}
                    className="bg-[#6D28D9] text-white px-2.5 py-1.5 rounded-lg text-xs font-medium hover:bg-[#5B21B6] border border-violet-400/30"
                    title="Reassign Manager"
                  >
                    Reassign
                  </button>
                )}
                <button
                  type="button"
                  onClick={(e) => {
                    e.stopPropagation()
                    onDelete()
                  }}
                  className="bg-red-500 text-white px-2.5 py-1.5 rounded-lg text-xs font-medium hover:bg-red-600"
                  title="Delete"
                >
                  Delete
                </button>
              </>
            )}
            {event.status === 'completed' && (
              <>
                <button
                  type="button"
                  onClick={(e) => {
                    e.stopPropagation()
                    onEdit()
                  }}
                  className="btn-haus-fill rounded-lg px-2.5 py-1.5 text-xs"
                  title="Edit"
                >
                  Edit
                </button>
                <button
                  type="button"
                  onClick={(e) => {
                    e.stopPropagation()
                    onDelete()
                  }}
                  className="bg-red-500 text-white px-2.5 py-1.5 rounded-lg text-xs font-medium hover:bg-red-600"
                  title="Delete"
                >
                  Delete
                </button>
              </>
            )}
          </div>
          {event.status !== 'completed' && (
            <select
              value={event.status}
              onChange={(e) => {
                e.stopPropagation()
                onUpdate({ status: e.target.value as Event['status'] })
              }}
              onClick={(e) => e.stopPropagation()}
              className="w-full max-w-[11rem] px-2 py-1.5 border border-white/[0.15] rounded-lg text-xs bg-[#0B0B0D] text-white"
              title="Change Status"
            >
              <option value="draft">Draft</option>
              <option value="collecting_interest">Interest</option>
              <option value="open">Open</option>
              <option value="closed">Closed</option>
              <option value="completed">Completed</option>
            </select>
          )}
        </div>
      </td>
    </tr>
  )
}

