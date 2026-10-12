import { useState, useEffect, type ReactNode } from 'react'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { useNavigate, Link, useSearchParams } from 'react-router-dom'
import toast from 'react-hot-toast'
import { authApi } from '../lib/auth'
import { ticketsApi, preRegistrationsApi, pointsApi, referralsApi, userProfilesApi, stripeApi, vatReceiptApi, refundApi, settingsApi, discountCodesApi, eventsApi, redemptionsApi } from '../lib/api'
import { shopApi, formatPence } from '../lib/shopApi'
import { isAndroid, isIOS } from '../lib/device'
import { supabase } from '../lib/supabase'
import SEO from '../components/SEO'
import ProfileCompletionModal from '../components/ProfileCompletionModal'
import PreferenceCenter from '../components/PreferenceCenter'
import YaugaLoader from '../components/YaugaLoader'
import RedemptionsModal from '../components/RedemptionsModal'
import PointsHistoryModal from '../components/PointsHistoryModal'
import MyWalletCard from '../components/MyWalletCard'
import YaugaRingProfileSection from '../components/YaugaRingProfileSection'
import ReferralStampsSection from '../components/ReferralStampsSection'
import { nextRedemptionProgress } from '../components/PointsProgressDial'
import { useBrandName } from '../lib/useBrandName'
import type { ShopOrder, ShopRefundRequest } from '../types/database'
import { formatEventDate, formatEventTime } from '../lib/eventDateTime'
import {
  cacheMemberTimeZone,
  detectDeviceTimeZone,
  listTimeZones,
} from '../lib/memberTimezone'
import {
  COMPLIMENTARY_REFERRAL_STAMPS,
  REFERRAL_REWARDS_SETTING_KEY,
  nextReferralMilestoneProgress,
  parseReferralRewardsSetting,
} from '../lib/referralRewards'
import { useDesktopPageClass } from '../hooks/useDesktopPageClass'
import { getYaugaTokenSettings } from '../lib/yaugaToken'
import { FlapCount } from '../components/events/eventDetailKit'
import '../styles/yauga-kit.css'

function ProfileFact({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="dashboard-fact">
      <dt className="utility utility-s muted">{label}</dt>
      <dd className="quiet">{children}</dd>
    </div>
  )
}

export default function DashboardPage() {
  const navigate = useNavigate()
  const queryClient = useQueryClient()
  const { brandName } = useBrandName()
  const desktop = useDesktopPageClass()
  const [searchParams, setSearchParams] = useSearchParams()
  const [activeTab, setActiveTab] = useState<
    'booked' | 'pre-registered' | 'attended' | 'ended' | 'history' | 'my-codes' | 'my-referrals' | 'shop-orders'
  >('booked')
  const [bookedPage, setBookedPage] = useState(1)
  const [preRegisteredPage, setPreRegisteredPage] = useState(1)
  const [attendedPage, setAttendedPage] = useState(1)
  const [endedPage, setEndedPage] = useState(1)
  const [historyPage, setHistoryPage] = useState(1)
  const [myCodesPage, setMyCodesPage] = useState(1)
  const [showProfileModal, setShowProfileModal] = useState(false)
  const [showRedemptionsModal, setShowRedemptionsModal] = useState(false)
  const [showPointsHistoryModal, setShowPointsHistoryModal] = useState(false)
  const [shopOrderDetailId, setShopOrderDetailId] = useState<string | null>(null)
  const [shopRefundOrder, setShopRefundOrder] = useState<ShopOrder | null>(null)
  const [shopRefundReason, setShopRefundReason] = useState('')
  const [shopRefundPhone, setShopRefundPhone] = useState('')
  const [shopRefundViewOrderId, setShopRefundViewOrderId] = useState<string | null>(null)
  const [shopRefundSelectedLineIds, setShopRefundSelectedLineIds] = useState<Set<string>>(new Set())

  const ITEMS_PER_PAGE = 10

  const { data: session, isLoading: sessionLoading } = useQuery({
    queryKey: ['session'],
    queryFn: () => authApi.getSession(),
  })

  const userEmail = session?.user?.email

  useEffect(() => {
    if (!sessionLoading && !session) {
      navigate('/login', { replace: true })
    }
  }, [session, sessionLoading, navigate])

  const { data: tickets = [] } = useQuery({
    queryKey: ['tickets', userEmail],
    queryFn: async () => {
      if (!userEmail) return []
      const ticketsList = await ticketsApi.listByEmail(userEmail)
      // Fetch event details for each ticket
      const ticketsWithEvents = await Promise.all(
        ticketsList.map(async (ticket) => {
          const { data: event } = await supabase
            .from('events')
            .select('*')
            .eq('id', ticket.event_id)
            .single()
          return { ...ticket, event }
        })
      )
      return ticketsWithEvents
    },
    enabled: !!userEmail,
  })

  const { data: preRegistrations = [] } = useQuery({
    queryKey: ['pre-registrations', userEmail],
    queryFn: () => (userEmail ? preRegistrationsApi.listByEmail(userEmail) : []),
    enabled: !!userEmail,
  })

  // Filter out pre-registrations for events where user has a ticket
  const eventIdsWithTickets = new Set(tickets.map(t => t.event_id))
  const filteredPreRegistrations = preRegistrations.filter(
    pr => !eventIdsWithTickets.has(pr.event_id)
  )

  const { data: points = 0 } = useQuery({
    queryKey: ['points', userEmail],
    queryFn: () => (userEmail ? pointsApi.getBalance(userEmail) : 0),
    enabled: !!userEmail,
    refetchOnWindowFocus: true,
  })

  const { data: redemptionItems = [] } = useQuery({
    queryKey: ['redemption-items-active'],
    queryFn: () => redemptionsApi.listActiveItems(),
    enabled: !!userEmail,
  })

  const { data: pointsHistory = [] } = useQuery({
    queryKey: ['points-history', userEmail],
    queryFn: () => (userEmail ? pointsApi.getHistory(userEmail) : []),
    enabled: !!userEmail && activeTab === 'history',
    refetchOnWindowFocus: true,
  })

  const { data: myCodes = [] } = useQuery({
    queryKey: ['my-codes', userEmail],
    queryFn: () => discountCodesApi.getMyCodes(),
    enabled: !!userEmail,
    refetchOnWindowFocus: true,
  })

  const { data: referrals = [] } = useQuery({
    queryKey: ['referrals', userEmail],
    queryFn: () => (userEmail ? referralsApi.listByReferrer(userEmail) : []),
    enabled: !!userEmail,
  })
  const completedReferralCount = referrals.filter((row: { status?: string }) => row.status === 'completed').length

  const { data: referralRewardsSetting } = useQuery({
    queryKey: ['setting', REFERRAL_REWARDS_SETTING_KEY],
    queryFn: () => settingsApi.get(REFERRAL_REWARDS_SETTING_KEY).catch(() => null),
    retry: false,
  })

  const { data: enableGoogleWalletSetting } = useQuery({
    queryKey: ['setting', 'enable_google_wallet'],
    queryFn: () => settingsApi.get('enable_google_wallet').catch(() => null),
    retry: false,
  })
  const enableGoogleWallet = enableGoogleWalletSetting?.value === 'true'
  const showAddToGoogleWallet = enableGoogleWallet && isAndroid()

  const { data: enableAppleWalletSetting } = useQuery({
    queryKey: ['setting', 'enable_apple_wallet'],
    queryFn: () => settingsApi.get('enable_apple_wallet').catch(() => null),
    retry: false,
  })
  const enableAppleWallet = enableAppleWalletSetting?.value === 'true'
  const showAddToAppleWallet = enableAppleWallet && isIOS()

  const userId = session?.user?.id

  const { data: shopOrdersWithLines = [] } = useQuery({
    queryKey: ['shop-orders-with-lines', userId],
    queryFn: () => shopApi.listMyOrdersWithLineItems(),
    enabled: !!userId,
  })

  const { data: myShopRefundRequests = [] } = useQuery({
    queryKey: ['shop-refund-requests', userId],
    queryFn: () => shopApi.listMyShopRefundRequests(),
    enabled: !!userId,
  })

  const { data: shopOrderDetail, isLoading: shopOrderDetailLoading } = useQuery({
    queryKey: ['shop-order-detail', userId, shopOrderDetailId],
    queryFn: () => (shopOrderDetailId ? shopApi.getMyOrderWithDetails(shopOrderDetailId) : null),
    enabled: !!userId && !!shopOrderDetailId,
  })

  const { data: shopRefundDetail } = useQuery({
    queryKey: ['shop-order-detail', userId, shopRefundOrder?.id],
    queryFn: () => shopApi.getMyOrderWithDetails(shopRefundOrder!.id),
    enabled: !!userId && !!shopRefundOrder,
  })

  const shopRefundMutation = useMutation({
    mutationFn: () => {
      if (!shopRefundOrder) throw new Error('No order selected')
      const lineItemIds = [...shopRefundSelectedLineIds]
      if (lineItemIds.length === 0) throw new Error('Select at least one item to return')
      return shopApi.requestShopRefund({
        orderId: shopRefundOrder.id,
        reason: shopRefundReason.trim(),
        contactPhone: shopRefundPhone.trim() || undefined,
        lineItemIds,
      })
    },
    onSuccess: (data) => {
      toast.success(data?.message || 'Refund request sent')
      setShopRefundOrder(null)
      setShopRefundReason('')
      setShopRefundPhone('')
      setShopRefundSelectedLineIds(new Set())
      queryClient.invalidateQueries({ queryKey: ['shop-refund-requests', userId] })
      queryClient.invalidateQueries({ queryKey: ['shop-orders-with-lines', userId] })
    },
    onError: (e: Error) => toast.error(e.message || 'Failed to send request'),
  })

  const { data: userProfile, isLoading: isLoadingUserProfile } = useQuery({
    queryKey: ['user-profile', userId],
    queryFn: () => (userId ? userProfilesApi.getProfileByUserId(userId) : null),
    enabled: !!userId,
  })

  const { data: tokenSettings } = useQuery({
    queryKey: ['yauga-token-settings'],
    queryFn: () => getYaugaTokenSettings(),
    enabled: !!userId,
  })

  const [userName, setUserName] = useState('')
  const [isEditingProfile, setIsEditingProfile] = useState(false)
  const [userExperience, setUserExperience] = useState<'foundation' | 'flow' | 'peak' | null>(null)
  const [userTimezone, setUserTimezone] = useState('')
  const [yaugaLocation, setYaugaLocation] = useState('')
  const [showAdminMenu, setShowAdminMenu] = useState(true)

  const { data: eventCities = [] } = useQuery({
    queryKey: ['event-cities-unique'],
    queryFn: () => eventsApi.getUniqueCities(),
  })

  useEffect(() => {
    if (userProfile) {
      setUserName(userProfile.name || '')
      setUserExperience(userProfile.experience || null)
      setUserTimezone(userProfile.timezone || '')
      setYaugaLocation(userProfile.yauga_location || '')
      setShowAdminMenu(userProfile.show_admin_menu !== false)
    }
  }, [userProfile])

  // Check if profile is incomplete and show modal
  useEffect(() => {
    if (!userId) return
    if (isLoadingUserProfile) return

    const isComplete =
      !!userProfile?.name &&
      !!userProfile?.experience &&
      !!userProfile?.timezone &&
      !!userProfile?.yauga_location?.trim()
    const forced = searchParams.get('completeProfile') === 'true'
    const shouldShowModal = forced || !isComplete

    if (shouldShowModal) {
      setShowProfileModal(true)
      if (forced) {
        setSearchParams({}, { replace: true })
      }
    } else {
      // If profile is complete, ensure we don't keep it open.
      setShowProfileModal(false)
    }
  }, [userProfile, userId, isLoadingUserProfile, searchParams, setSearchParams])

  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key !== 'Escape') return
      if (shopRefundOrder) {
        e.preventDefault()
        setShopRefundOrder(null)
        setShopRefundReason('')
        setShopRefundPhone('')
        setShopRefundSelectedLineIds(new Set())
        return
      }
      if (shopRefundViewOrderId) {
        e.preventDefault()
        setShopRefundViewOrderId(null)
        return
      }
      if (shopOrderDetailId) {
        e.preventDefault()
        setShopOrderDetailId(null)
      }
    }
    document.addEventListener('keydown', onKeyDown)
    return () => document.removeEventListener('keydown', onKeyDown)
  }, [shopRefundOrder, shopRefundViewOrderId, shopOrderDetailId])

  // Reset page when tab changes
  useEffect(() => {
    setBookedPage(1)
    setPreRegisteredPage(1)
    setAttendedPage(1)
    setEndedPage(1)
    setHistoryPage(1)
    setMyCodesPage(1)
  }, [activeTab])

  const handleProfileComplete = () => {
    setShowProfileModal(false)
    toast.success(`Welcome to ${brandName}!`)
  }

  const updateProfileDetailsMutation = useMutation({
    mutationFn: (payload: {
      name: string
      experience: 'foundation' | 'flow' | 'peak'
      timezone: string
      yauga_location: string | null
      show_admin_menu: boolean
    }) => {
      if (!userId) throw new Error('Not authenticated')
      return userProfilesApi.updateProfile(userId, {
        name: payload.name,
        experience: payload.experience,
        timezone: payload.timezone,
        yauga_location: payload.yauga_location,
        preferred_wearable: 'yauga_ring',
        show_admin_menu: payload.show_admin_menu,
      })
    },
    onSuccess: (data, variables) => {
      if (data) {
        queryClient.setQueriesData({ queryKey: ['user-profile'] }, (old: unknown) => {
          if (!old || typeof old !== 'object') return data
          const prev = old as { user_id?: string }
          if (prev.user_id && data.user_id && prev.user_id !== data.user_id) return old
          return { ...prev, ...data }
        })
      }
      queryClient.invalidateQueries({ queryKey: ['user-profile'] })
      queryClient.invalidateQueries({ queryKey: ['profile'] })
      setIsEditingProfile(false)
      toast.success('Profile updated')
      cacheMemberTimeZone(variables.timezone)
    },
    onError: (error: any) => {
      toast.error(error.message || 'Could not update profile')
    },
  })

  const handleProfileSubmit = (e: React.FormEvent) => {
    e.preventDefault()
    if (!userName.trim()) {
      toast.error('Name cannot be empty')
      return
    }
    if (!userExperience) {
      toast.error('Please select your experience level')
      return
    }
    if (!userTimezone.trim()) {
      toast.error('Please select your timezone')
      return
    }
    updateProfileDetailsMutation.mutate({
      name: userName.trim(),
      experience: userExperience,
      timezone: userTimezone.trim(),
      yauga_location: yaugaLocation.trim() || null,
      show_admin_menu: showAdminMenu,
    })
  }

  const experienceDisplay: Record<'foundation' | 'flow' | 'peak', string> = {
    foundation: 'Foundation',
    flow: 'Flow',
    peak: 'Peak',
  }

  const referralRewardsConfig = parseReferralRewardsSetting(referralRewardsSetting?.value)
  const referralStampCount = completedReferralCount + COMPLIMENTARY_REFERRAL_STAMPS
  const nextReferralGoal = nextReferralMilestoneProgress(
    referralStampCount,
    referralRewardsConfig.milestones
  )
  const nextPointsGoal = nextRedemptionProgress(points, redemptionItems)

  if (sessionLoading || !session) {
    return (
      <>
        <SEO title="Dashboard" noIndex />
        <div className="flex min-h-[40vh] items-center justify-center">
          <YaugaLoader />
        </div>
      </>
    )
  }

  const now = new Date()
  const bookedTickets = tickets.filter((t) => t.status === 'booked')
  const attendedTickets = tickets.filter((t) => t.checked_in === true)

  // Active bookings: booked, not attended, and event is in the future (or has no date)
  const activeBookings = bookedTickets.filter((t) => {
    if (t.checked_in === true) return false
    const eventDate = t.event?.event_date ? new Date(t.event.event_date) : null
    if (!eventDate || Number.isNaN(eventDate.getTime())) return true
    return eventDate.getTime() >= now.getTime()
  })

  // Expired: booked, not attended, and event is in the past (date/time)
  const expiredBookings = bookedTickets.filter((t) => {
    if (t.checked_in === true) return false
    const eventDate = t.event?.event_date ? new Date(t.event.event_date) : null
    if (!eventDate || Number.isNaN(eventDate.getTime())) return false
    return eventDate.getTime() < now.getTime()
  })

  const sortByEventDateDesc = (a: any, b: any) => {
    const da = a.event?.event_date ? new Date(a.event.event_date).getTime() : 0
    const db = b.event?.event_date ? new Date(b.event.event_date).getTime() : 0
    return db - da
  }

  const sortByEventDateAsc = (a: any, b: any) => {
    const da = a.event?.event_date ? new Date(a.event.event_date).getTime() : Number.POSITIVE_INFINITY
    const db = b.event?.event_date ? new Date(b.event.event_date).getTime() : Number.POSITIVE_INFINITY
    return da - db
  }

  const nextBookingTicket =
    activeBookings.length > 0 ? [...activeBookings].sort(sortByEventDateAsc)[0] : null
  const nextBookingEvent = nextBookingTicket?.event
  const nextBookingAt = nextBookingEvent?.event_date ? new Date(nextBookingEvent.event_date) : null
  const nextBookingAtValid = !!(nextBookingAt && !Number.isNaN(nextBookingAt.getTime()))

  const activeBookingsSorted = [...activeBookings].sort(sortByEventDateDesc)
  const expiredBookingsSorted = [...expiredBookings].sort(sortByEventDateDesc)
  const attendedTicketsSorted = [...attendedTickets].sort(sortByEventDateDesc)
  const refundedTickets = tickets.filter((t) => t.status === 'refunded')
  const cancelledTicketsSorted = [...refundedTickets].sort((a, b) => {
    const da = a.refunded_at ? new Date(a.refunded_at).getTime() : 0
    const db = b.refunded_at ? new Date(b.refunded_at).getTime() : 0
    return db - da
  })

  // Pagination calculations
  const getPaginatedData = <T,>(data: T[], page: number) => {
    const startIndex = (page - 1) * ITEMS_PER_PAGE
    const endIndex = startIndex + ITEMS_PER_PAGE
    return {
      items: data.slice(startIndex, endIndex),
      totalPages: Math.ceil(data.length / ITEMS_PER_PAGE),
      currentPage: page,
      totalItems: data.length,
    }
  }

  const refundHistoryEntries = refundedTickets.map((t) => {
    const amountPence = t.ticket_price_pence ?? Math.max(0, (t.price_pence ?? 0) - (t.booking_fee_pence ?? 0))
    return {
      type: 'refund' as const,
      date: t.refunded_at || t.created_at,
      eventName: t.event?.name ?? 'Unknown event',
      refundType: t.refund_type ?? 'credit_only',
      amountPence,
    }
  })

  const shopLoyaltyByOrderId = new Map<string, number>()
  for (const h of pointsHistory) {
    if (h.reason === 'shop_order' && h.shopOrderId) {
      shopLoyaltyByOrderId.set(h.shopOrderId, h.pointsAwarded)
    }
  }
  const shopOrderHistoryRows = shopOrdersWithLines
    .filter((row) => row.order.status === 'paid')
    .map((row) => ({
      type: 'shop-order' as const,
      date: row.order.created_at,
      eventName: 'Placed Shop Order' as const,
      price: row.order.total_pence,
      pointsAwarded: shopLoyaltyByOrderId.get(row.order.id) ?? 0,
    }))

  const pointsHistoryWithType = pointsHistory
    .filter((h) => h.reason !== 'shop_order' && h.pointsAwarded !== 0)
    .map((h) => ({ ...h, type: 'points' as const }))
  const combinedHistory = [...refundHistoryEntries, ...pointsHistoryWithType, ...shopOrderHistoryRows].sort(
    (a, b) => new Date(b.date).getTime() - new Date(a.date).getTime()
  )
  const historyPagination = getPaginatedData(combinedHistory, historyPage)

  const bookedPagination = getPaginatedData(activeBookingsSorted, bookedPage)
  const preRegisteredPagination = getPaginatedData(filteredPreRegistrations, preRegisteredPage)
  const attendedPagination = getPaginatedData(attendedTicketsSorted, attendedPage)
  const endedTicketsSorted = [...cancelledTicketsSorted, ...expiredBookingsSorted].sort(
    sortByEventDateDesc
  )
  const endedPagination = getPaginatedData(endedTicketsSorted, endedPage)
  const myCodesPagination = getPaginatedData(myCodes, myCodesPage)

  return (
    <>
      <SEO title="Dashboard" noIndex />
    <div className={`yauga-home${desktop ? ' desktop' : ''}`}>
      <div className="dashboard-kit">
        <header className="dashboard-hero">
          <h1 className="display xl">Your dashboard</h1>
          <p className="quiet muted">Everything you have booked, earned and chosen.</p>
        </header>
      <div className="cards dashboard-board">

      {/* My Details: profile, points, next booking, locations */}
      <section
        className="card dashboard-card dashboard-profile"
        aria-labelledby="my-details-heading"
      >
        {isEditingProfile ? (
          <form onSubmit={handleProfileSubmit} className="space-y-4 p-4 sm:p-6">
            <h2 id="my-details-heading" className="text-lg font-semibold text-white">
              My Details
            </h2>
            <div className="grid grid-cols-1 gap-6 lg:grid-cols-2">
              <div className="space-y-4">
            <div>
              <label htmlFor="profile-name" className="block text-sm font-medium text-white/75 mb-1.5">
                Name
              </label>
              <input
                id="profile-name"
                type="text"
                value={userName}
                onChange={(e) => setUserName(e.target.value)}
                className="input-focus-ring w-full min-h-[44px] px-3 py-2.5 text-base text-white bg-[#050505] border border-white/[0.15] rounded-[12px] placeholder:text-white/40 focus:border-[#8B5CF6] focus:ring-2 focus:ring-[#8B5CF6]/30"
                placeholder="Your name"
                required
                autoComplete="name"
              />
            </div>
            <div>
              <label htmlFor="profile-experience" className="block text-sm font-medium text-white/75 mb-1.5">
                Experience
              </label>
              <select
                id="profile-experience"
                value={userExperience || ''}
                onChange={(e) => {
                  const v = e.target.value as 'foundation' | 'flow' | 'peak' | ''
                  setUserExperience(v ? v : null)
                }}
                className="input-focus-ring w-full min-h-[44px] px-3 py-2.5 text-base text-white border border-white/[0.15] rounded-[12px] focus:ring-2 focus:ring-[#8B5CF6]/30 bg-[#050505] focus:border-[#8B5CF6]"
                required
              >
                <option value="">Select level</option>
                <option value="foundation">Foundation (Beginner)</option>
                <option value="flow">Flow (Experienced)</option>
                <option value="peak">Peak (Pro)</option>
              </select>
            </div>
            <div>
              <label htmlFor="profile-timezone" className="block text-sm font-medium text-white/75 mb-1.5">
                Timezone
              </label>
              <select
                id="profile-timezone"
                value={userTimezone}
                onChange={(e) => setUserTimezone(e.target.value)}
                className="input-focus-ring w-full min-h-[44px] px-3 py-2.5 text-base text-white border border-white/[0.15] rounded-[12px] focus:ring-2 focus:ring-[#8B5CF6]/30 bg-[#050505] focus:border-[#8B5CF6]"
                required
              >
                <option value="">Select timezone</option>
                {listTimeZones().map((tz) => (
                  <option key={tz} value={tz}>
                    {tz}
                  </option>
                ))}
              </select>
              <p className="mt-1 text-xs text-white/45">
                Used for ring days and sleep.{' '}
                {detectDeviceTimeZone() ? (
                  <button
                    type="button"
                    className="text-[#A78BFA] underline"
                    onClick={() => setUserTimezone(detectDeviceTimeZone() || '')}
                  >
                    Use device ({detectDeviceTimeZone()})
                  </button>
                ) : null}
              </p>
            </div>
              </div>
              <div className="space-y-4">
            <div>
              <label htmlFor="profile-yauga-location" className="block text-sm font-medium text-white/75 mb-1.5">
                Location
              </label>
              <select
                id="profile-yauga-location"
                value={yaugaLocation}
                onChange={(e) => setYaugaLocation(e.target.value)}
                className="input-focus-ring w-full min-h-[44px] px-3 py-2.5 text-base text-white border border-white/[0.15] rounded-[12px] focus:ring-2 focus:ring-[#8B5CF6]/30 bg-[#050505] focus:border-[#8B5CF6]"
              >
                <option value="">Select city</option>
                {yaugaLocation && !eventCities.includes(yaugaLocation) ? (
                  <option value={yaugaLocation}>{yaugaLocation}</option>
                ) : null}
                {eventCities.map((city) => (
                  <option key={city} value={city}>
                    {city}
                  </option>
                ))}
              </select>
              <p className="mt-1 text-xs text-white/45">
                Your home city for community leaderboards and local posts.
              </p>
            </div>
            <fieldset>
              <legend className="block text-sm font-medium text-white/75 mb-1.5">
                Yauga Ring
              </legend>
              <YaugaRingProfileSection
                editing
                autoOpen={searchParams.get('registerRing') === '1'}
                onAutoOpenConsumed={() => {
                  if (!searchParams.get('registerRing')) return
                  const next = new URLSearchParams(searchParams)
                  next.delete('registerRing')
                  setSearchParams(next, { replace: true })
                }}
              />
              <p className="mt-1 text-xs text-white/45">
                Register your physical Yauga Ring (Bluetooth + NFC) to unlock ring features and event
                check-in.
              </p>
            </fieldset>
            {userProfile?.is_admin ? (
              <fieldset>
                <legend className="block text-sm font-medium text-white/75 mb-1.5">
                  Show Admin menu
                </legend>
                <div className="flex rounded-lg border border-white/[0.15] overflow-hidden text-sm font-semibold max-w-xs">
                  <button
                    type="button"
                    onClick={() => setShowAdminMenu(true)}
                    className={`flex-1 min-h-[44px] px-3 ${
                      showAdminMenu
                        ? 'bg-[#8B5CF6]/25 text-white'
                        : 'text-white/55 hover:text-white hover:bg-white/[0.04]'
                    }`}
                    aria-pressed={showAdminMenu}
                  >
                    Yes
                  </button>
                  <button
                    type="button"
                    onClick={() => setShowAdminMenu(false)}
                    className={`flex-1 min-h-[44px] px-3 border-l border-white/[0.15] ${
                      !showAdminMenu
                        ? 'bg-[#8B5CF6]/25 text-white'
                        : 'text-white/55 hover:text-white hover:bg-white/[0.04]'
                    }`}
                    aria-pressed={!showAdminMenu}
                  >
                    No
                  </button>
                </div>
                <p className="mt-1 text-xs text-white/45">
                  When No, Admin is hidden from the site menu (you can still open /admin directly).
                </p>
              </fieldset>
            ) : null}
              </div>
            </div>
            <div className="dashboard-card-actions" style={{ paddingTop: 0 }}>
              <button
                type="submit"
                disabled={updateProfileDetailsMutation.isPending}
                className="btn"
              >
                {updateProfileDetailsMutation.isPending ? 'Saving…' : 'Save'}
              </button>
              <button
                type="button"
                onClick={() => {
                  setIsEditingProfile(false)
                  setUserName(userProfile?.name || '')
                  setUserExperience(userProfile?.experience || null)
                  setUserTimezone(userProfile?.timezone || '')
                  setYaugaLocation(userProfile?.yauga_location || '')
                  setShowAdminMenu(userProfile?.show_admin_menu !== false)
                }}
                className="btn btn-ghost"
              >
                Cancel
              </button>
            </div>
          </form>
        ) : (
          <>
            <div className="dashboard-profile-body">
              <div className="dashboard-profile-head">
                <div className="min-w-0 flex-1">
                  <h2 id="my-details-heading" className="utility utility-s muted">
                    My Details
                  </h2>
                  <p className="display s dashboard-profile-name">
                    {userProfile?.name || 'Not set'}
                  </p>
                  <p className="small muted" style={{ marginTop: 'var(--s2)' }}>
                    {userProfile?.experience
                      ? experienceDisplay[userProfile.experience]
                      : 'Experience not set'}
                    <span className="dashboard-profile-sep" aria-hidden>
                      ·
                    </span>
                    <span>{userProfile?.timezone || 'Timezone not set'}</span>
                  </p>
                </div>
                <div className="dashboard-profile-actions">
                  <a
                    href="#privacy-preferences"
                    className="btn"
                    onClick={() => window.dispatchEvent(new Event('yh-open-privacy-prefs'))}
                  >
                    Preferences
                  </a>
                  <button
                    type="button"
                    onClick={() => setIsEditingProfile(true)}
                    className="btn"
                  >
                    {userProfile?.name ? 'Edit' : 'Set up'}
                  </button>
                </div>
              </div>
              <dl className="dashboard-facts">
                <ProfileFact label="Email">
                  <span className="dashboard-email">{userEmail || 'Not set'}</span>
                </ProfileFact>
                <ProfileFact label="Location">
                  {userProfile?.yauga_location || 'Not set'}
                </ProfileFact>
                <YaugaRingProfileSection
                  compact
                  autoOpen={searchParams.get('registerRing') === '1'}
                  onAutoOpenConsumed={() => {
                    if (!searchParams.get('registerRing')) return
                    const next = new URLSearchParams(searchParams)
                    next.delete('registerRing')
                    setSearchParams(next, { replace: true })
                  }}
                />
                {userProfile?.is_admin ? (
                  <ProfileFact label="Admin menu">
                    {userProfile.show_admin_menu !== false ? 'Yes' : 'No'}
                  </ProfileFact>
                ) : null}
              </dl>
            </div>
          </>
        )}
      </section>

      <div className="dashboard-stack">
        <section className="card dashboard-card" aria-labelledby="dash-next-booking">
          <h2 id="dash-next-booking" className="display m card-title">
            Next booking
          </h2>
          {nextBookingEvent ? (
            <div style={{ marginTop: 'var(--s4)' }}>
              <p className="display s">{nextBookingEvent.name}</p>
              {nextBookingAtValid && nextBookingAt ? (
                <p className="utility utility-s muted" style={{ marginTop: 'var(--s2)' }}>
                  {nextBookingAt.toLocaleString('en-GB', {
                    weekday: 'short',
                    day: 'numeric',
                    month: 'short',
                    year: 'numeric',
                    hour: '2-digit',
                    minute: '2-digit',
                    hour12: false,
                  })}
                </p>
              ) : (
                <p className="small muted" style={{ marginTop: 'var(--s2)' }}>
                  Date TBA
                </p>
              )}
              <Link to={`/events/${nextBookingEvent.id}`} className="btn btn-ghost">
                View event
              </Link>
            </div>
          ) : (
            <>
              <p className="quiet muted" style={{ marginTop: 'var(--s4)' }}>
                No upcoming bookings.
              </p>
              <Link to="/events" className="btn">
                Browse events
              </Link>
            </>
          )}
        </section>

        <section className="card dashboard-card" aria-labelledby="dash-points">
          <h2 id="dash-points" className="display m card-title">
            Points
          </h2>
          <div className="dashboard-flap-row">
            <FlapCount
              count={points}
              minDigits={1}
              maxDigits={6}
              suffix={
                nextPointsGoal.needed != null
                  ? `of ${nextPointsGoal.needed.toLocaleString()}`
                  : 'points'
              }
            />
          </div>
          <p className="small muted">Points come from turning up, not from how hard you worked.</p>
          <div className="dashboard-card-actions">
            <button type="button" className="btn" onClick={() => setShowRedemptionsModal(true)}>
              My redemptions
            </button>
            {tokenSettings?.enabled ? (
              <button type="button" className="btn btn-live" onClick={() => setShowRedemptionsModal(true)}>
                Convert tokens
              </button>
            ) : null}
            <button type="button" className="btn" onClick={() => setShowPointsHistoryModal(true)}>
              History
            </button>
          </div>
        </section>

        {tokenSettings?.enabled && userId ? (
          <MyWalletCard userId={userId} linkedAddress={userProfile?.solana_wallet || null} />
        ) : null}

        <section className="card dashboard-card" aria-labelledby="dash-referrals">
          <h2 id="dash-referrals" className="display m card-title">
            Referrals
          </h2>
          <div className="dashboard-flap-row">
            <FlapCount
              count={referralStampCount}
              minDigits={1}
              maxDigits={4}
              suffix={
                nextReferralGoal.needed > 0 && !nextReferralGoal.allUnlocked
                  ? `of ${nextReferralGoal.needed}`
                  : 'referrals'
              }
            />
          </div>
          <p className="small muted">
            {nextReferralGoal.needed > 0
              ? `${nextReferralGoal.needed} more to the next reward.`
              : 'Keep bringing people in.'}
          </p>
          <div className="dashboard-card-actions">
            <button
              type="button"
              className="btn"
              onClick={() => {
                setActiveTab('my-referrals')
                document.getElementById('dashboard-bookings')?.scrollIntoView({ behavior: 'smooth', block: 'start' })
              }}
            >
              My referrals
            </button>
          </div>
        </section>
      </div>

      {session?.user?.id && userEmail ? (
        <section className="card dashboard-card dashboard-privacy" aria-label="Privacy">
          <h2 className="display m card-title">Privacy</h2>
          <PreferenceCenter
            userId={session.user.id}
            userEmail={userEmail}
            profile={userProfile ?? null}
            embedded
          />
        </section>
      ) : null}

      {/* Bookings tabs */}
      <section id="dashboard-bookings" className="card dashboard-card dashboard-bookings-card" aria-label="Bookings">
        <h2 className="display m card-title">Bookings</h2>
        <div className="dashboard-tab-row" role="tablist" aria-label="Bookings">
          {(
            [
              { id: 'booked', label: `Active (${activeBookingsSorted.length})` },
              { id: 'pre-registered', label: `Pre-reg (${filteredPreRegistrations.length})` },
              { id: 'attended', label: `Attended (${attendedTicketsSorted.length})` },
              { id: 'ended', label: `Ended (${endedTicketsSorted.length})` },
              { id: 'shop-orders', label: `Shop (${shopOrdersWithLines.length})` },
              { id: 'my-referrals', label: `Referrals (${completedReferralCount})` },
              { id: 'my-codes', label: `Codes (${myCodes.length})` },
              { id: 'history', label: 'History' },
            ] as const
          ).map((tab) => {
            const selected = activeTab === tab.id
            return (
              <button
                key={tab.id}
                type="button"
                role="tab"
                aria-selected={selected}
                aria-label={
                  tab.id === 'booked'
                    ? `Active Bookings (${activeBookingsSorted.length})`
                    : tab.id === 'pre-registered'
                      ? `Pre-registered (${filteredPreRegistrations.length})`
                      : tab.id === 'ended'
                        ? `Cancelled and expired (${endedTicketsSorted.length})`
                        : tab.id === 'shop-orders'
                          ? `Shop orders (${shopOrdersWithLines.length})`
                          : tab.id === 'my-referrals'
                            ? `My Referrals (${completedReferralCount})`
                            : tab.id === 'my-codes'
                              ? `My Codes (${myCodes.length})`
                              : tab.label
                }
                onClick={() => setActiveTab(tab.id)}
                className={`dashboard-tab${selected ? ' on' : ''}`}
              >
                {tab.label}
              </button>
            )
          })}
        </div>

      <div className="dashboard-bookings-panel">
        {activeTab === 'booked' && (
          <>
            {activeBookingsSorted.length === 0 ? (
              <div className="text-center py-12 text-white/50">
                No booked tickets yet. <Link to="/events" className="text-primary hover:underline">Browse events</Link>
              </div>
            ) : (
              <>
                {bookedPagination.items.map((ticket) => (
                  <TicketCard key={ticket.id} ticket={ticket} showAddToGoogleWallet={showAddToGoogleWallet} showAddToAppleWallet={showAddToAppleWallet} />
                ))}
                {bookedPagination.totalPages > 1 && (
                  <Pagination
                    currentPage={bookedPage}
                    totalPages={bookedPagination.totalPages}
                    onPageChange={setBookedPage}
                    totalItems={bookedPagination.totalItems}
                    itemsPerPage={ITEMS_PER_PAGE}
                  />
                )}
              </>
            )}
          </>
        )}

        {activeTab === 'pre-registered' && (
          <>
            {filteredPreRegistrations.length === 0 ? (
              <div className="text-center py-12 text-white/50">
                No pre-registrations yet. <Link to="/events" className="text-primary hover:underline">Browse events</Link>
              </div>
            ) : (
              <>
                <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 sm:gap-5 lg:grid-cols-3">
                  {preRegisteredPagination.items.map((pr) => (
                    <PreRegistrationCard key={pr.id} preRegistration={pr} />
                  ))}
                </div>
                {preRegisteredPagination.totalPages > 1 && (
                  <Pagination
                    currentPage={preRegisteredPage}
                    totalPages={preRegisteredPagination.totalPages}
                    onPageChange={setPreRegisteredPage}
                    totalItems={preRegisteredPagination.totalItems}
                    itemsPerPage={ITEMS_PER_PAGE}
                  />
                )}
              </>
            )}
          </>
        )}

        {activeTab === 'attended' && (
          <>
            {attendedTicketsSorted.length === 0 ? (
              <div className="text-center py-12 text-white/50">No attended events yet.</div>
            ) : (
              <>
                {attendedPagination.items.map((ticket) => (
                  <TicketCard key={ticket.id} ticket={ticket} showReferral={false} showAddToGoogleWallet={showAddToGoogleWallet} showAddToAppleWallet={showAddToAppleWallet} />
                ))}
                {attendedPagination.totalPages > 1 && (
                  <Pagination
                    currentPage={attendedPage}
                    totalPages={attendedPagination.totalPages}
                    onPageChange={setAttendedPage}
                    totalItems={attendedPagination.totalItems}
                    itemsPerPage={ITEMS_PER_PAGE}
                  />
                )}
              </>
            )}
          </>
        )}

        {activeTab === 'ended' && (
          <>
            {endedTicketsSorted.length === 0 ? (
              <div className="text-center py-12 text-white/50">No cancelled or expired bookings.</div>
            ) : (
              <>
                {endedPagination.items.map((ticket) => (
                  <TicketCard
                    key={ticket.id}
                    ticket={ticket}
                    showReferral={false}
                    showRefund={false}
                    showAddToGoogleWallet={showAddToGoogleWallet}
                    showAddToAppleWallet={showAddToAppleWallet}
                  />
                ))}
                {endedPagination.totalPages > 1 && (
                  <Pagination
                    currentPage={endedPage}
                    totalPages={endedPagination.totalPages}
                    onPageChange={setEndedPage}
                    totalItems={endedPagination.totalItems}
                    itemsPerPage={ITEMS_PER_PAGE}
                  />
                )}
              </>
            )}
          </>
        )}

        {activeTab === 'history' && (
          <>
            {combinedHistory.length === 0 ? (
              <div className="text-center py-12 text-white/50">No history yet.</div>
            ) : (
              <>
                <div className="bg-[#0B0B0D] rounded-xl shadow-sm border border-white/[0.12] overflow-hidden">
                  <table className="min-w-full divide-y divide-white/[0.12]">
                    <caption className="sr-only">
                      History: refunds, points, and shop orders (date, description, amount, points)
                    </caption>
                    <thead className="bg-[#070707]">
                      <tr>
                        <th scope="col" className="px-6 py-3 text-left text-xs font-medium text-white/50 uppercase tracking-wider">
                          Date and Time
                        </th>
                        <th scope="col" className="px-6 py-3 text-left text-xs font-medium text-white/50 uppercase tracking-wider">
                          Event / Description
                        </th>
                        <th scope="col" className="px-6 py-3 text-left text-xs font-medium text-white/50 uppercase tracking-wider">
                          Price / Amount
                        </th>
                        <th scope="col" className="px-6 py-3 text-left text-xs font-medium text-white/50 uppercase tracking-wider">
                          Points
                        </th>
                      </tr>
                    </thead>
                    <tbody className="bg-[#0B0B0D] divide-y divide-white/[0.12]">
                      {historyPagination.items.map((row, index) =>
                        row.type === 'refund' ? (
                          <tr key={`refund-${row.date}-${row.eventName}-${index}`}>
                            <td className="px-6 py-4 whitespace-nowrap text-sm text-white">
                              {new Date(row.date).toLocaleString('en-GB', {
                                year: 'numeric',
                                month: 'long',
                                day: 'numeric',
                                hour: '2-digit',
                                minute: '2-digit',
                              })}
                            </td>
                            <td className="px-6 py-4 text-sm text-white">
                              {row.eventName}
                              <span className="text-white/50 ml-1">
                                ({row.refundType === 'stripe_refund' ? 'Money refund' : 'Credit issued'})
                              </span>
                            </td>
                            <td className="px-6 py-4 whitespace-nowrap text-sm text-white/50">
                              £{(row.amountPence / 100).toFixed(2)}
                            </td>
                            <td className="px-6 py-4 whitespace-nowrap text-sm text-white/40">-</td>
                          </tr>
                        ) : row.type === 'shop-order' ? (
                          <tr key={`shop-order-${row.date}-${row.price}-${index}`}>
                            <td className="px-6 py-4 whitespace-nowrap text-sm text-white">
                              {new Date(row.date).toLocaleString('en-GB', {
                                year: 'numeric',
                                month: 'long',
                                day: 'numeric',
                                hour: '2-digit',
                                minute: '2-digit',
                              })}
                            </td>
                            <td className="px-6 py-4 text-sm text-white font-medium">{row.eventName}</td>
                            <td className="px-6 py-4 whitespace-nowrap text-sm text-white/50">
                              £{(row.price / 100).toFixed(2)}
                            </td>
                            <td className={`px-6 py-4 whitespace-nowrap text-sm font-medium ${
                              row.pointsAwarded > 0 ? 'text-primary' : 'text-white/40'
                            }`}>
                              {row.pointsAwarded > 0 ? (
                                <>
                                  +{row.pointsAwarded.toLocaleString()}
                                </>
                              ) : (
                                '-'
                              )}
                            </td>
                          </tr>
                        ) : row.type === 'points' ? (
                          <tr key={`points-${row.date}-${index}`}>
                            <td className="px-6 py-4 whitespace-nowrap text-sm text-white">
                              {new Date(row.date).toLocaleString('en-GB', {
                                year: 'numeric',
                                month: 'long',
                                day: 'numeric',
                                hour: '2-digit',
                                minute: '2-digit',
                              })}
                            </td>
                            <td className="px-6 py-4 text-sm text-white">
                              {row.reason === 'referral' ? (
                                <span>
                                  {row.eventName} <span className="text-primary font-medium">(Event Referral)</span>
                                </span>
                              ) : row.reason === 'share' ? (
                                <span className="font-medium">{row.eventName}</span>
                              ) : (
                                row.eventName
                              )}
                            </td>
                            <td className="px-6 py-4 whitespace-nowrap text-sm text-white/50">
                              {row.reason === 'share' ? '' : (row.price ? `£${(row.price / 100).toFixed(2)}` : '-')}
                            </td>
                            <td className={`px-6 py-4 whitespace-nowrap text-sm font-medium ${
                              row.pointsAwarded >= 0 ? 'text-primary' : 'text-red-600'
                            }`}>
                              {row.pointsAwarded >= 0 ? '+' : ''}
                              {row.pointsAwarded.toLocaleString()}
                            </td>
                          </tr>
                        ) : null
                      )}
                    </tbody>
                  </table>
                </div>
                {historyPagination.totalPages > 1 && (
                  <Pagination
                    currentPage={historyPage}
                    totalPages={historyPagination.totalPages}
                    onPageChange={setHistoryPage}
                    totalItems={historyPagination.totalItems}
                    itemsPerPage={ITEMS_PER_PAGE}
                  />
                )}
              </>
            )}
          </>
        )}

        {activeTab === 'my-referrals' && (
          userEmail ? (
            <ReferralStampsSection userEmail={userEmail} />
          ) : (
            <div className="text-center py-12 text-white/50">Sign in to see your referrals.</div>
          )
        )}

        {activeTab === 'my-codes' && (
          <>
            {myCodes.length === 0 ? (
                <div className="text-center py-12 text-white/50">
                  You have no discount codes. Refund credits and referral rewards will appear here when issued.
                </div>
            ) : (
              <>
                <div className="bg-[#0B0B0D] rounded-xl shadow-sm border border-white/[0.12] overflow-hidden">
                  <table className="min-w-full divide-y divide-white/[0.12]">
                    <caption className="sr-only">
                      My Codes: code, amount, reason, issued, expires, status, used at
                    </caption>
                    <thead className="bg-[#070707]">
                      <tr>
                        <th scope="col" className="px-6 py-3 text-left text-xs font-medium text-white/50 uppercase tracking-wider">
                          Code
                        </th>
                        <th scope="col" className="px-6 py-3 text-left text-xs font-medium text-white/50 uppercase tracking-wider">
                          Amount
                        </th>
                        <th scope="col" className="px-6 py-3 text-left text-xs font-medium text-white/50 uppercase tracking-wider">
                          Why issued
                        </th>
                        <th scope="col" className="px-6 py-3 text-left text-xs font-medium text-white/50 uppercase tracking-wider">
                          Issued
                        </th>
                        <th scope="col" className="px-6 py-3 text-left text-xs font-medium text-white/50 uppercase tracking-wider">
                          Expires
                        </th>
                        <th scope="col" className="px-6 py-3 text-left text-xs font-medium text-white/50 uppercase tracking-wider">
                          Status
                        </th>
                        <th scope="col" className="px-6 py-3 text-left text-xs font-medium text-white/50 uppercase tracking-wider">
                          Used at
                        </th>
                      </tr>
                    </thead>
                    <tbody className="bg-[#0B0B0D] divide-y divide-white/[0.12]">
                      {myCodesPagination.items.map((c) => (
                        <tr key={c.id}>
                          <td className="px-6 py-4 whitespace-nowrap text-sm font-mono font-medium text-white">
                            {c.code}
                          </td>
                          <td className="px-6 py-4 whitespace-nowrap text-sm text-white/75">
                            {c.discount_amount_pence != null && c.discount_amount_pence > 0
                              ? `£${(c.discount_amount_pence / 100).toFixed(2)}`
                              : c.discount_percent > 0
                                ? `${c.discount_percent}%`
                                : '-'}
                          </td>
                          <td className="px-6 py-4 text-sm text-white">
                            {c.reason ?? '-'}
                          </td>
                          <td className="px-6 py-4 whitespace-nowrap text-sm text-white/65">
                            {new Date(c.created_at).toLocaleString('en-GB', { day: '2-digit', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit' })}
                          </td>
                          <td className="px-6 py-4 whitespace-nowrap text-sm text-white/65">
                            {new Date(c.end_date).toLocaleString('en-GB', { day: '2-digit', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit' })}
                          </td>
                          <td className="px-6 py-4 whitespace-nowrap">
                            {c.used_count > 0 ? (
                              <span className="text-amber-700 font-medium">Used</span>
                            ) : new Date(c.end_date) < new Date() ? (
                              <span className="text-white/50">Expired</span>
                            ) : (
                              <span className="text-primary font-medium">Valid</span>
                            )}
                          </td>
                          <td className="px-6 py-4 whitespace-nowrap text-sm text-white/50">
                            {c.used_at
                              ? new Date(c.used_at).toLocaleString('en-GB', { day: '2-digit', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit' })
                              : '-'}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
                {myCodesPagination.totalPages > 1 && (
                  <Pagination
                    currentPage={myCodesPage}
                    totalPages={myCodesPagination.totalPages}
                    onPageChange={setMyCodesPage}
                    totalItems={myCodesPagination.totalItems}
                    itemsPerPage={ITEMS_PER_PAGE}
                  />
                )}
              </>
            )}
          </>
        )}

        {activeTab === 'shop-orders' && (
          <>
            {shopOrdersWithLines.length === 0 ? (
              <div className="text-center py-12 text-white/50">
                No shop orders yet.{' '}
                <Link to="/shop" className="text-primary hover:underline">
                  Browse the shop
                </Link>
              </div>
            ) : (
              <div className="bg-[#0B0B0D] rounded-xl shadow-sm border border-white/[0.12] overflow-x-auto">
                <table className="min-w-full divide-y divide-white/[0.12]">
                  <caption className="sr-only">Shop orders</caption>
                  <thead className="bg-[#070707]">
                    <tr>
                      <th
                        scope="col"
                        className="px-6 py-3 text-left text-xs font-medium text-white/50 uppercase tracking-wider"
                      >
                        Date
                      </th>
                      <th
                        scope="col"
                        className="px-6 py-3 text-left text-xs font-medium text-white/50 normal-case tracking-wider"
                      >
                        Order (click to view)
                      </th>
                      <th
                        scope="col"
                        className="px-6 py-3 text-left text-xs font-medium text-white/50 uppercase tracking-wider"
                      >
                        Status
                      </th>
                      <th
                        scope="col"
                        className="px-6 py-3 text-right text-xs font-medium text-white/50 uppercase tracking-wider"
                      >
                        Total
                      </th>
                      <th
                        scope="col"
                        className="px-6 py-3 text-left text-xs font-medium text-white/50 uppercase tracking-wider"
                      >
                        Card receipt
                      </th>
                      <th
                        scope="col"
                        className="px-6 py-3 text-left text-xs font-medium text-white/50 uppercase tracking-wider"
                      >
                        Invoice
                      </th>
                      <th
                        scope="col"
                        className="px-6 py-3 text-left text-xs font-medium text-white/50 uppercase tracking-wider"
                      >
                        Refund
                      </th>
                    </tr>
                  </thead>
                  <tbody className="bg-[#0B0B0D] divide-y divide-white/[0.12]">
                    {shopOrdersWithLines.map((row) => {
                      const o = row.order
                      const lineIds = row.items.map((i) => i.id)
                      const createdAt = new Date(o.created_at)
                      const shopOrderTimeLine = createdAt.toLocaleString('en-GB', {
                        hour: '2-digit',
                        minute: '2-digit',
                        hour12: false,
                      })
                      const shopOrderDateLine = createdAt.toLocaleDateString('en-GB', {
                        day: 'numeric',
                        month: 'short',
                        year: 'numeric',
                      })
                      const rf = shopRefundUiState(o, myShopRefundRequests, lineIds)
                      return (
                      <tr
                        key={o.id}
                        className="cursor-pointer hover:bg-[#070707]/80 transition-colors"
                        aria-label={`View details for shop order ${o.order_number != null ? `YH-${o.order_number}` : o.id}`}
                        onClick={(e) => {
                          if ((e.target as HTMLElement).closest('button, a')) return
                          setShopOrderDetailId(o.id)
                        }}
                      >
                        <td className="px-6 py-4 text-sm text-white/65 leading-tight">
                          {shopOrderTimeLine}
                          <br />
                          {shopOrderDateLine}
                        </td>
                        <td className="px-6 py-4 text-sm text-white max-w-[220px]">
                          <div className="font-semibold text-primary">
                            {o.order_number != null ? `YH-${o.order_number}` : 'Order'}
                          </div>
                          <div className="font-mono text-[10px] text-white/40 break-all mt-0.5" title={o.id}>
                            {o.id}
                          </div>
                        </td>
                        <td className="px-6 py-4 whitespace-nowrap text-sm capitalize">
                          <span
                            className={
                              o.status === 'paid'
                                ? 'text-emerald-700 font-medium'
                                : o.status === 'pending'
                                  ? 'text-amber-700'
                                  : 'text-white/65'
                            }
                          >
                            {o.status}
                          </span>
                        </td>
                        <td className="px-6 py-4 whitespace-nowrap text-sm text-right font-medium text-white">
                          {formatPence(o.total_pence, o.currency)}
                        </td>
                        <td className="px-6 py-4 whitespace-nowrap text-sm">
                          {o.status === 'paid' &&
                          o.stripe_checkout_session_id &&
                          !o.stripe_checkout_session_id.startsWith('free_shop_') ? (
                            <button
                              type="button"
                              className="text-primary font-medium hover:underline"
                              onClick={async (e) => {
                                e.stopPropagation()
                                try {
                                  const url = await stripeApi.getReceiptUrl(o.stripe_checkout_session_id!)
                                  window.open(url, '_blank', 'noopener,noreferrer')
                                } catch (err: unknown) {
                                  toast.error(err instanceof Error ? err.message : 'Could not open receipt')
                                }
                              }}
                            >
                              View (Stripe)
                            </button>
                          ) : (
                            <span className="text-white/40">-</span>
                          )}
                        </td>
                        <td className="px-6 py-4 whitespace-nowrap text-sm">
                          {o.status === 'paid' ? (
                            <button
                              type="button"
                              className="text-primary font-medium hover:underline"
                              onClick={async (e) => {
                                e.stopPropagation()
                                try {
                                  await vatReceiptApi.generateShopOrderInvoice(o.id)
                                  toast.success('Invoice downloaded')
                                } catch (err: unknown) {
                                  toast.error(err instanceof Error ? err.message : 'Could not generate invoice')
                                }
                              }}
                            >
                              Download PDF
                            </button>
                          ) : (
                            <span className="text-white/40">-</span>
                          )}
                        </td>
                        <td className="px-6 py-4 text-sm min-w-[8rem]">
                          <div className="flex flex-col gap-1 items-start">
                            {rf.hasHistory && (
                              <button
                                type="button"
                                className="text-primary font-medium hover:underline"
                                onClick={(e) => {
                                  e.stopPropagation()
                                  setShopRefundViewOrderId(o.id)
                                }}
                              >
                                View refund
                              </button>
                            )}
                            {rf.canSubmitNew && (
                              <button
                                type="button"
                                className="text-primary font-medium hover:underline"
                                onClick={(e) => {
                                  e.stopPropagation()
                                  setShopRefundOrder(o)
                                  setShopRefundReason('')
                                  setShopRefundPhone('')
                                  setShopRefundSelectedLineIds(new Set())
                                }}
                              >
                                Request refund
                              </button>
                            )}
                            {o.status === 'paid' && !rf.hasHistory && !rf.canSubmitNew && (
                              <span className="text-white/40">-</span>
                            )}
                            {o.status !== 'paid' && <span className="text-white/40">-</span>}
                          </div>
                        </td>
                      </tr>
                      )
                    })}
                  </tbody>
                </table>
              </div>
            )}
          </>
        )}
      </div>
      </section>

      {/* Shop order detail (modal) */}
      {shopOrderDetailId && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/50"
          role="dialog"
          aria-modal="true"
          aria-labelledby="shop-order-detail-title"
          onClick={(e) => {
            if (e.target === e.currentTarget) setShopOrderDetailId(null)
          }}
        >
          <div className="bg-[#0B0B0D] rounded-xl shadow-xl max-w-2xl w-full min-w-0 max-h-[90vh] overflow-y-auto">
            <div className="p-6 border-b border-white/[0.12] flex justify-between items-start gap-4">
              <div>
                <h2 id="shop-order-detail-title" className="text-xl font-semibold text-white">
                  Order details
                </h2>
                {shopOrderDetail?.order && (
                  <p className="text-sm text-white/65 mt-1">
                    {shopOrderDetail.order.order_number != null
                      ? `YH-${shopOrderDetail.order.order_number}`
                      : shopOrderDetail.order.id}
                  </p>
                )}
              </div>
              <button
                type="button"
                className="text-white/50 hover:text-white/90 text-2xl leading-none min-h-[44px] min-w-[44px] inline-flex items-center justify-center rounded-lg focus-ring"
                aria-label="Close"
                onClick={() => setShopOrderDetailId(null)}
              >
                ×
              </button>
            </div>
            <div className="p-6 space-y-4 text-sm">
              {shopOrderDetailLoading && <YaugaLoader size="sm" className="py-4" />}
              {!shopOrderDetailLoading && !shopOrderDetail && (
                <p className="text-white/50">Could not load this order.</p>
              )}
              {shopOrderDetail && (
                <>
                  {(() => {
                    const o = shopOrderDetail.order
                    const itemsNetPence = shopApi.merchandiseSubtotalPenceFromItems(shopOrderDetail.items)
                    const shipPence = Math.max(0, Math.round(Number(o.shipping_fee_pence) || 0))
                    const merchandiseTotalPence = itemsNetPence + shipPence
                    const discPence = Math.max(0, Math.round(Number(o.discount_total_pence) || 0))
                    const linked = shopOrderDetail.linkedTicket
                    const isTicketCombo = Boolean(linked || o.event_id)
                    return (
                      <>
                  <div className="grid grid-cols-2 gap-2 text-white/75">
                    <span className="text-white/50">Date</span>
                    <span>
                      {new Date(shopOrderDetail.order.created_at).toLocaleString('en-GB', {
                        day: '2-digit',
                        month: 'short',
                        year: 'numeric',
                        hour: '2-digit',
                        minute: '2-digit',
                      })}
                    </span>
                    <span className="text-white/50">Status</span>
                    <span className="capitalize">{shopOrderDetail.order.status}</span>
                    <span className="text-white/50">{isTicketCombo ? 'Merchandise total' : 'Total'}</span>
                    <span className="font-medium">
                      {formatPence(merchandiseTotalPence, shopOrderDetail.order.currency)}
                    </span>
                  </div>
                  {isTicketCombo && (
                    <div className="text-sm text-white/75 bg-slate-50 border border-slate-200 rounded-lg px-3 py-2 space-y-1">
                      <p className="font-medium text-white">Ticket and merchandise in one payment</p>
                      <p>
                        This order was checked out with your event ticket on the same card payment. Amounts below are{' '}
                        <span className="font-medium">merchandise only</span> (not the ticket).
                      </p>
                      {linked && (
                        <p className="text-white/65">
                          Ticket side of that payment
                          {linked.event_title ? ` · ${linked.event_title}` : ''}:{' '}
                          <span className="font-medium text-white">
                            {formatPence(linked.price_pence, o.currency)}
                          </span>
                          {linked.ticket_price_pence != null && linked.booking_fee_pence > 0 ? (
                            <span className="text-white/50">
                              {' '}
                              (ticket {formatPence(linked.ticket_price_pence, o.currency)}, booking fee{' '}
                              {formatPence(linked.booking_fee_pence, o.currency)})
                            </span>
                          ) : null}
                        </p>
                      )}
                    </div>
                  )}
                  {shopOrderDetail.order.event_pickup === true && (
                    <p className="text-amber-800 bg-amber-50 border border-amber-100 rounded-lg px-3 py-2">
                      Event collection - no shipping address. Collect your items at the event.
                    </p>
                  )}
                  <div>
                    <h3 className="font-medium text-white mb-2">Items</h3>
                    <ul className="border border-white/[0.12] rounded-lg divide-y divide-gray-100">
                      {shopOrderDetail.items.map((line) => {
                        const lineTotalPence = line.price_at_purchase_pence * line.quantity
                        const lineTotalMajor = lineTotalPence / 100
                        return (
                          <li key={line.id} className="px-3 py-2 flex justify-between gap-2">
                            <span>
                              <span className="font-medium text-white">{line.product_name}</span>
                              <span className="text-white/50"> × {line.quantity}</span>
                            </span>
                            <span className="text-white shrink-0">
                              {shopOrderDetail.order.currency === 'USD' ? '$' : '£'}
                              {lineTotalMajor.toLocaleString('en-GB', {
                                minimumFractionDigits: 2,
                                maximumFractionDigits: 2,
                              })}
                            </span>
                          </li>
                        )
                      })}
                    </ul>
                  </div>
                  <div className="grid grid-cols-1 gap-1 text-white/75 border-t border-white/[0.08] pt-3">
                    <div className="flex justify-between">
                      <span>Items subtotal</span>
                      <span>{formatPence(itemsNetPence, shopOrderDetail.order.currency)}</span>
                    </div>
                    <div className="flex justify-between">
                      <span>Shipping</span>
                      <span>
                        {formatPence(shopOrderDetail.order.shipping_fee_pence, shopOrderDetail.order.currency)}
                      </span>
                    </div>
                    {discPence > 0 && (
                      <p className="text-xs text-emerald-800 bg-emerald-50 border border-emerald-100 rounded-lg px-3 py-2 -mx-0.5">
                        Total savings on list prices: {formatPence(discPence, o.currency)}. Item prices above already
                        include these discounts.
                      </p>
                    )}
                    <div className="flex justify-between font-medium text-white pt-1 border-t border-white/[0.08]">
                      <span>{isTicketCombo ? 'Merchandise paid' : 'Total paid'}</span>
                      <span>{formatPence(merchandiseTotalPence, o.currency)}</span>
                    </div>
                  </div>
                      </>
                    )
                  })()}
                  {shopOrderDetail.order.event_pickup !== true && (
                    <div>
                      <h3 className="font-medium text-white mb-1">Delivery</h3>
                      <p className="text-white/75 whitespace-pre-line text-sm">
                        {formatShopOrderShipping(shopOrderDetail.order.shipping_address)}
                      </p>
                    </div>
                  )}
                  {(() => {
                    const detailRf = shopRefundUiState(
                      shopOrderDetail.order,
                      myShopRefundRequests,
                      shopOrderDetail.items.map((i) => i.id)
                    )
                    if (detailRf.list.length === 0 && !detailRf.canSubmitNew) return null
                    return (
                      <div className="space-y-3 pt-2 border-t border-white/[0.08]">
                        {detailRf.list.length > 0 && (
                          <div>
                            <h3 className="font-medium text-white mb-2">Refund requests</h3>
                            <ul className="text-sm space-y-2">
                              {detailRf.list.map((r) => (
                                <li key={r.id} className="border border-white/[0.08] rounded-lg px-3 py-2 bg-[#070707]">
                                  <div className="flex justify-between gap-2 flex-wrap">
                                    <span
                                      className={`font-medium capitalize ${
                                        r.status === 'pending'
                                          ? 'text-amber-800'
                                          : r.status === 'awaiting_return'
                                            ? 'text-indigo-800'
                                            : r.status === 'returned_received'
                                              ? 'text-blue-800'
                                              : r.status === 'approved'
                                                ? 'text-emerald-800'
                                                : 'text-white/90'
                                      }`}
                                    >
                                      {r.status}
                                    </span>
                                    <span className="text-white/50 text-xs">
                                      {new Date(r.created_at).toLocaleString('en-GB', {
                                        day: '2-digit',
                                        month: 'short',
                                        year: 'numeric',
                                        hour: '2-digit',
                                        minute: '2-digit',
                                      })}
                                    </span>
                                  </div>
                                  {r.status === 'approved' && r.refund_amount_pence != null && (
                                    <p className="text-white/75 mt-1">
                                      Refunded {formatPence(r.refund_amount_pence, shopOrderDetail.order.currency)}
                                      {r.refund_kind ? ` (${r.refund_kind})` : ''}
                                    </p>
                                  )}
                                  {r.status === 'awaiting_return' && (
                                    <div className="mt-1 space-y-1 text-xs">
                                      {r.rma_code ? <p className="text-white/75">RMA: {r.rma_code}</p> : null}
                                      {r.return_address_text ? (
                                        <p className="text-white/75 whitespace-pre-line">{r.return_address_text}</p>
                                      ) : null}
                                      {r.rma_qr_url ? (
                                        <a href={r.rma_qr_url} target="_blank" rel="noopener noreferrer" className="text-primary hover:underline">
                                          Open RMA QR code
                                        </a>
                                      ) : null}
                                    </div>
                                  )}
                                  {r.status === 'returned_received' && (
                                    <p className="text-blue-700 mt-1 text-xs">
                                      Return received. Awaiting refund processing.
                                    </p>
                                  )}
                                  {r.status === 'rejected' && r.rejection_note && (
                                    <p className="text-white/65 mt-1 text-xs">{r.rejection_note}</p>
                                  )}
                                </li>
                              ))}
                            </ul>
                          </div>
                        )}
                        {detailRf.canSubmitNew && (
                          <button
                            type="button"
                            className="btn-haus-fill focus-ring min-h-[44px] w-full rounded-lg px-4 py-2.5 sm:w-auto"
                            onClick={() => {
                              setShopOrderDetailId(null)
                              setShopRefundOrder(shopOrderDetail.order)
                              setShopRefundReason('')
                              setShopRefundPhone('')
                              setShopRefundSelectedLineIds(new Set())
                            }}
                          >
                            Request refund
                          </button>
                        )}
                      </div>
                    )
                  })()}
                </>
              )}
            </div>
          </div>
        </div>
      )}

      {/* Shop refund request (modal) */}
      {shopRefundOrder && (
        <div
          className="fixed inset-0 z-[60] flex items-center justify-center p-4 bg-black/50"
          role="dialog"
          aria-modal="true"
          aria-labelledby="shop-refund-title"
          aria-describedby="shop-refund-desc"
          onClick={(e) => {
            if (e.target === e.currentTarget) {
              setShopRefundOrder(null)
              setShopRefundReason('')
              setShopRefundPhone('')
              setShopRefundSelectedLineIds(new Set())
            }
          }}
        >
          <div className="bg-[#0B0B0D] rounded-xl shadow-xl max-w-lg w-full min-w-0 p-6 max-h-[90vh] overflow-y-auto">
            <div className="flex justify-between items-start gap-2 mb-1">
              <h2 id="shop-refund-title" className="text-lg font-semibold text-white pr-2">
                Request a return / refund
              </h2>
              <button
                type="button"
                className="text-white/50 hover:text-white/90 text-2xl leading-none min-h-[44px] min-w-[44px] shrink-0 inline-flex items-center justify-center rounded-lg focus-ring"
                aria-label="Close"
                onClick={() => {
                  setShopRefundOrder(null)
                  setShopRefundReason('')
                  setShopRefundPhone('')
                  setShopRefundSelectedLineIds(new Set())
                }}
              >
                ×
              </button>
            </div>
            <p id="shop-refund-desc" className="text-sm text-white/65 mb-4">
              Order{' '}
              {shopRefundOrder.order_number != null ? `YH-${shopRefundOrder.order_number}` : shopRefundOrder.id}.
              Select the item(s) you want to return. If items are fulfilled by different partners, we will open one
              return request per partner. Your message is sent securely to our team; we will usually reply to your
              account email ({userEmail || 'on file'}).
            </p>
            {!shopRefundDetail && (
              <p className="text-sm text-white/65 mb-3" aria-live="polite">
                Loading items…
              </p>
            )}
            {shopRefundDetail && (() => {
              const cov = shopRefundCoverage(refundRequestsForOrder(shopRefundOrder.id, myShopRefundRequests))
              const lineBlocked = (lineId: string) => cov.mode === 'all' || cov.ids.has(lineId)
              const selected = shopRefundSelectedLineIds
              const groupKeys = new Set<string>()
              for (const id of selected) {
                const line = shopRefundDetail.items.find((i) => i.id === id)
                if (line) groupKeys.add(line.fulfilment_returns_key)
              }
              return (
                <fieldset className="border-0 p-0 m-0 min-w-0 space-y-3 mb-4">
                  <legend className="text-sm font-medium text-white/90 mb-2">Items to return</legend>
                  <ul className="border border-white/[0.12] rounded-lg divide-y divide-gray-100 max-h-48 overflow-y-auto">
                    {shopRefundDetail.items.map((line) => {
                      const blocked = lineBlocked(line.id)
                      const checked = selected.has(line.id)
                      const lineTotal = line.price_at_purchase_pence * line.quantity
                      return (
                        <li key={line.id} className="px-3 py-2.5 flex gap-2 items-start min-h-[44px]">
                          <input
                            type="checkbox"
                            id={`shop-refund-line-${line.id}`}
                            className="mt-1.5 shrink-0 input-focus-ring rounded"
                            disabled={blocked}
                            checked={checked}
                            onChange={(e) => {
                              setShopRefundSelectedLineIds((prev) => {
                                const next = new Set(prev)
                                if (e.target.checked) next.add(line.id)
                                else next.delete(line.id)
                                return next
                              })
                            }}
                          />
                          <label htmlFor={`shop-refund-line-${line.id}`} className="flex-1 text-sm cursor-pointer min-w-0">
                            <span className="font-medium text-white">{line.product_name}</span>
                            <span className="text-white/65"> × {line.quantity}</span>
                            {blocked ? (
                              <span className="block text-xs text-amber-800 mt-0.5">Already in an active refund</span>
                            ) : (
                              <span className="block text-xs text-white/65 mt-0.5">
                                {line.fulfilment_returns_key === 'platform' ? 'Platform fulfilment' : 'Third-party fulfilment'}
                              </span>
                            )}
                          </label>
                          <span className="text-sm text-white shrink-0">
                            {formatPence(lineTotal, shopRefundOrder.currency)}
                          </span>
                        </li>
                      )
                    })}
                  </ul>
                  {selected.size > 0 && (
                    <p className="text-xs text-white/75">
                      {groupKeys.size > 1
                        ? `This will create ${groupKeys.size} separate return requests (different fulfilment addresses).`
                        : 'One return request will be created for the selected item(s).'}
                    </p>
                  )}
                </fieldset>
              )
            })()}
            <div className="space-y-3">
              <div>
                <label htmlFor="shop-refund-reason" className="block text-sm font-medium text-white/75 mb-1">
                  Reason <span className="text-red-600">*</span>
                </label>
                <textarea
                  id="shop-refund-reason"
                  value={shopRefundReason}
                  onChange={(e) => setShopRefundReason(e.target.value)}
                  rows={4}
                  className="w-full border border-white/[0.15] rounded-lg px-3 py-2 text-sm input-focus-ring"
                  placeholder="Describe why you are requesting a refund…"
                  required
                />
              </div>
              <div>
                <label htmlFor="shop-refund-phone" className="block text-sm font-medium text-white/75 mb-1">
                  Contact phone <span className="text-white/50 font-normal">(optional)</span>
                </label>
                <input
                  id="shop-refund-phone"
                  type="tel"
                  value={shopRefundPhone}
                  onChange={(e) => setShopRefundPhone(e.target.value)}
                  className="w-full border border-white/[0.15] rounded-lg px-3 py-2 text-sm input-focus-ring"
                  placeholder="If you would like us to call you"
                />
              </div>
            </div>
            <div className="flex flex-wrap gap-2 justify-end mt-6">
              <button
                type="button"
                className="px-4 py-2.5 min-h-[44px] rounded-lg text-sm font-medium text-white/75 bg-white/[0.08] hover:bg-white/[0.1] focus-ring"
                onClick={() => {
                  setShopRefundOrder(null)
                  setShopRefundReason('')
                  setShopRefundPhone('')
                  setShopRefundSelectedLineIds(new Set())
                }}
              >
                Cancel
              </button>
              <button
                type="button"
                className="btn-haus-fill focus-ring min-h-[44px] rounded-lg px-4 py-2.5 text-sm disabled:opacity-50"
                disabled={
                  !shopRefundReason.trim() ||
                  shopRefundMutation.isPending ||
                  shopRefundSelectedLineIds.size === 0 ||
                  !shopRefundDetail
                }
                onClick={() => shopRefundMutation.mutate()}
              >
                {shopRefundMutation.isPending ? 'Sending…' : 'Send request'}
              </button>
            </div>
          </div>
        </div>
      )}

      {shopRefundViewOrderId &&
        (() => {
          const row = shopOrdersWithLines.find((x) => x.order.id === shopRefundViewOrderId)
          const vo = row?.order
          const vrf = vo ? shopRefundUiState(vo, myShopRefundRequests, row?.items.map((i) => i.id) ?? []) : null
          if (!vo || !vrf) return null
          return (
            <div
              className="fixed inset-0 z-[60] flex items-center justify-center p-4 bg-black/50"
              role="dialog"
              aria-modal="true"
              aria-labelledby="shop-refund-view-title"
              aria-describedby="shop-refund-view-desc"
              onClick={(e) => {
                if (e.target === e.currentTarget) setShopRefundViewOrderId(null)
              }}
            >
              <div className="bg-[#0B0B0D] rounded-xl shadow-xl max-w-md w-full min-w-0 p-6 max-h-[85vh] overflow-y-auto">
                <div className="flex justify-between items-start gap-2 mb-3">
                  <h2 id="shop-refund-view-title" className="text-lg font-semibold text-white pr-2">
                    Refund requests
                  </h2>
                  <button
                    type="button"
                    className="text-white/50 hover:text-white/90 text-2xl leading-none min-h-[44px] min-w-[44px] shrink-0 inline-flex items-center justify-center rounded-lg focus-ring"
                    aria-label="Close"
                    onClick={() => setShopRefundViewOrderId(null)}
                  >
                    ×
                  </button>
                </div>
                <p id="shop-refund-view-desc" className="text-sm text-white/65 mb-4">
                  Order{' '}
                  {vo.order_number != null ? `YH-${vo.order_number}` : vo.id}
                </p>
                <ul className="text-sm space-y-2 mb-4">
                  {vrf.list.map((r) => (
                    <li key={r.id} className="border border-white/[0.12] rounded-lg px-3 py-2 bg-[#070707]">
                      <div className="flex justify-between gap-2 flex-wrap">
                        <span
                          className={`font-medium capitalize ${
                            r.status === 'pending'
                              ? 'text-amber-800'
                              : r.status === 'awaiting_return'
                                ? 'text-indigo-800'
                                : r.status === 'returned_received'
                                  ? 'text-blue-800'
                                  : r.status === 'approved'
                                    ? 'text-emerald-800'
                                    : 'text-white/90'
                          }`}
                        >
                          {r.status}
                        </span>
                        <span className="text-white/65 text-xs">
                          {new Date(r.created_at).toLocaleString('en-GB', {
                            day: '2-digit',
                            month: 'short',
                            year: 'numeric',
                            hour: '2-digit',
                            minute: '2-digit',
                          })}
                        </span>
                      </div>
                      {r.status === 'approved' && r.refund_amount_pence != null && (
                        <p className="text-white/75 mt-1">
                          Refunded {formatPence(r.refund_amount_pence, vo.currency)}
                          {r.refund_kind ? ` (${r.refund_kind})` : ''}
                        </p>
                      )}
                      {r.status === 'awaiting_return' && (
                        <div className="mt-1 space-y-1 text-xs">
                          {r.rma_code ? <p className="text-white/75">RMA: {r.rma_code}</p> : null}
                          {r.return_address_text ? (
                            <p className="text-white/75 whitespace-pre-line">{r.return_address_text}</p>
                          ) : null}
                          {r.rma_qr_url ? (
                            <a
                              href={r.rma_qr_url}
                              target="_blank"
                              rel="noopener noreferrer"
                              className="text-primary hover:underline focus-ring rounded"
                            >
                              Open RMA QR code
                            </a>
                          ) : null}
                        </div>
                      )}
                      {r.status === 'returned_received' && (
                        <p className="text-blue-800 mt-1 text-xs">
                          Return received. Awaiting refund processing.
                        </p>
                      )}
                      {r.status === 'rejected' && r.rejection_note && (
                        <p className="text-white/65 mt-1 text-xs">{r.rejection_note}</p>
                      )}
                    </li>
                  ))}
                </ul>
                <div className="flex flex-wrap gap-2 justify-end">
                  {vrf.canSubmitNew && (
                    <button
                      type="button"
                      className="btn-haus-fill focus-ring min-h-[44px] rounded-lg px-4 py-2.5 text-sm"
                      onClick={() => {
                        setShopRefundViewOrderId(null)
                        setShopRefundOrder(vo)
                        setShopRefundReason('')
                        setShopRefundPhone('')
                        setShopRefundSelectedLineIds(new Set())
                      }}
                    >
                      Request refund
                    </button>
                  )}
                  <button
                    type="button"
                    className="px-4 py-2.5 min-h-[44px] rounded-lg text-sm font-medium text-white/75 bg-white/[0.08] hover:bg-white/[0.1] focus-ring"
                    onClick={() => setShopRefundViewOrderId(null)}
                  >
                    Close
                  </button>
                </div>
              </div>
            </div>
          )
        })()}

      {/* Profile Completion Modal */}
      {showProfileModal && userId && userProfile && (
        <ProfileCompletionModal
          userId={userId}
          userEmail={userEmail}
          currentName={userProfile.name}
          currentExperience={userProfile.experience}
          currentTimezone={userProfile.timezone}
          currentYaugaLocation={userProfile.yauga_location}
          currentMarketingOptIn={userProfile.marketing_opt_in === true}
          onComplete={handleProfileComplete}
        />
      )}

      {/* Redemptions Modal */}
      {showRedemptionsModal && userEmail && (
        <RedemptionsModal
          isOpen={showRedemptionsModal}
          onClose={() => setShowRedemptionsModal(false)}
          userEmail={userEmail}
          userName={userProfile?.name || userName || ''}
          pointsBalance={points}
          solanaWallet={userProfile?.solana_wallet || null}
        />
      )}

      {showPointsHistoryModal && userEmail && (
        <PointsHistoryModal
          isOpen={showPointsHistoryModal}
          onClose={() => setShowPointsHistoryModal(false)}
          userEmail={userEmail}
          pointsBalance={points}
        />
      )}
      </div>
      </div>
    </div>
    </>
  )
}

function refundRequestsForOrder(orderId: string, requests: ShopRefundRequest[]) {
  return requests
    .filter((r) => r.shop_order_id === orderId)
    .sort((a, b) => new Date(b.created_at).getTime() - new Date(a.created_at).getTime())
}

function shopRefundCoverage(list: ShopRefundRequest[]): { mode: 'all' } | { mode: 'lines'; ids: Set<string> } {
  const ids = new Set<string>()
  for (const r of list) {
    if (!['pending', 'awaiting_return', 'returned_received', 'approved'].includes(r.status)) continue
    const li = r.line_item_ids
    if (li == null || li.length === 0) return { mode: 'all' }
    for (const id of li) ids.add(id)
  }
  return { mode: 'lines', ids }
}

function shopRefundUiState(o: ShopOrder, requests: ShopRefundRequest[], orderLineIds: string[]) {
  const list = refundRequestsForOrder(o.id, requests)
  const cov = shopRefundCoverage(list)
  const pending = list.find((r) => r.status === 'pending')
  const hasHistory = list.length > 0
  let canSubmitNew = false
  if (o.status === 'paid') {
    if (cov.mode === 'all') {
      canSubmitNew = false
    } else if (orderLineIds.length === 0) {
      canSubmitNew = false
    } else {
      canSubmitNew = orderLineIds.some((id) => !cov.ids.has(id))
    }
  }
  return { pending, canSubmitNew, hasHistory, list }
}

function formatShopOrderShipping(sa: Record<string, unknown> | null | undefined): string {
  if (!sa || typeof sa !== 'object') return '-'
  const lines: string[] = []
  const name = String((sa as { full_name?: string; name?: string }).full_name || (sa as { name?: string }).name || '').trim()
  if (name) lines.push(name)
  const email = String((sa as { email?: string }).email || '').trim()
  if (email) lines.push(email)
  const phone = String((sa as { phone?: string }).phone || '').trim()
  if (phone) lines.push(phone)
  const addr = (sa as { address?: Record<string, unknown> }).address
  if (addr && typeof addr === 'object') {
    const a = addr as Record<string, unknown>
    const p1 = String(a.line1 || '').trim()
    const p2 = String(a.line2 || '').trim()
    const city = String(a.city || '').trim()
    const state = String(a.state || '').trim()
    const pc = String(a.postal_code || '').trim()
    const country = String(a.country || '').trim()
    if (p1) lines.push(p1)
    if (p2) lines.push(p2)
    const cityLine = [city, state].filter(Boolean).join(', ')
    const cityPostal = [cityLine, pc].filter(Boolean).join(' ')
    if (cityPostal.trim()) lines.push(cityPostal.trim())
    else if (pc) lines.push(pc)
    if (country) lines.push(country)
  }
  return lines.length ? lines.join('\n') : '-'
}

function TicketCard({ ticket, showReferral = true, showRefund = true, showAddToGoogleWallet = false, showAddToAppleWallet = false }: { ticket: any; showReferral?: boolean; showRefund?: boolean; showAddToGoogleWallet?: boolean; showAddToAppleWallet?: boolean }) {
  const [showReferForm, setShowReferForm] = useState(false)
  const [friendEmail, setFriendEmail] = useState('')
  const [showRefundModal, setShowRefundModal] = useState(false)
  const [refundReason, setRefundReason] = useState('')
  const [receiptLoading, setReceiptLoading] = useState(false)
  const queryClient = useQueryClient()

  useEffect(() => {
    if (!showRefundModal) return
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key !== 'Escape') return
      e.preventDefault()
      setShowRefundModal(false)
      setRefundReason('')
    }
    document.addEventListener('keydown', onKeyDown)
    return () => document.removeEventListener('keydown', onKeyDown)
  }, [showRefundModal])
  const { data: session } = useQuery({
    queryKey: ['session'],
    queryFn: () => authApi.getSession(),
  })
  const userEmail = session?.user?.email
  const event = ticket.event

  const createReferralMutation = useMutation({
    mutationFn: async (email: string) => {
      // Use refresh-aware session so edge functions don't fail with expired JWT
      const freshSession = await authApi.getSessionWithRefresh()
      const freshEmail = freshSession?.user?.email
      if (!freshSession?.access_token || !freshEmail) throw new Error('Not authenticated')

      const referral = await referralsApi.create(freshEmail, ticket.id, ticket.event_id)
      
      // Send referral email via edge function
      const supabaseUrl = import.meta.env.VITE_SUPABASE_URL
      const response = await fetch(`${supabaseUrl}/functions/v1/send-referral`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'apikey': import.meta.env.VITE_SUPABASE_ANON_KEY,
          'Authorization': `Bearer ${freshSession.access_token}`,
        },
        body: JSON.stringify({
          referralCode: referral.referral_code,
          friendEmail: email,
          eventId: ticket.event_id,
          referrerEmail: freshEmail,
        }),
      })

      if (!response.ok) {
        const error = await response.text()
        throw new Error(error || 'Failed to send referral email')
      }

      return referral
    },
    onSuccess: () => {
      toast.success('Referral email sent!')
      setShowReferForm(false)
      setFriendEmail('')
      queryClient.invalidateQueries({ queryKey: ['referrals', userEmail] })
    },
    onError: (error: any) => {
      toast.error(error.message || 'Failed to send referral')
    },
  })

  const handleReferFriend = (e: React.FormEvent) => {
    e.preventDefault()
    if (!friendEmail || !friendEmail.includes('@')) {
      toast.error('Please enter a valid email address')
      return
    }
    createReferralMutation.mutate(friendEmail)
  }

  const generateVatReceiptMutation = useMutation({
    mutationFn: async () => {
      await vatReceiptApi.generateReceipt(ticket.id)
    },
    onSuccess: () => {
      toast.success('VAT invoice downloaded')
    },
    onError: (error: any) => {
      toast.error(error.message || 'Failed to generate VAT invoice')
    },
  })

  const processRefundMutation = useMutation({
    mutationFn: () => refundApi.processRefund(ticket.id, refundReason),
    onSuccess: (data: any) => {
      toast.success(data?.message || 'Refund processed')
      if (data?.emailSent === false) {
        toast('Confirmation email was not sent. Check your dashboard for refund details.', { duration: 6000 })
      }
      setShowRefundModal(false)
      setRefundReason('')
      queryClient.invalidateQueries({ queryKey: ['tickets', userEmail] })
    },
    onError: (error: any) => {
      toast.error(error.message || 'Refund failed')
    },
  })

  const submitRefundClaimMutation = useMutation({
    mutationFn: () => refundApi.submitRefundClaim(ticket.id, refundReason),
    onSuccess: (data: any) => {
      toast.success(data?.message || 'Refund claim submitted')
      if (data?.creditCode) toast.success(data.instructions, { duration: 8000 })
      if (data?.emailSent === false) {
        toast('Confirmation email was not sent. Your credit code is shown above-save it for your next booking.', { duration: 6000 })
      }
      setShowRefundModal(false)
      setRefundReason('')
      queryClient.invalidateQueries({ queryKey: ['tickets', userEmail] })
    },
    onError: (error: any) => {
      toast.error(error.message || 'Refund claim failed')
    },
  })

  if (!event) {
    return (
      <div className="bg-[#0B0B0D] rounded-xl shadow-sm p-6 border border-white/[0.12]">
        <p className="text-white/50">Loading event details...</p>
      </div>
    )
  }

  const eventDate = event.event_date ? new Date(event.event_date) : null
  const canReferFriend = !!eventDate && eventDate.getTime() > Date.now()
  const daysToEvent = eventDate && eventDate.getTime() > Date.now()
    ? Math.ceil((eventDate.getTime() - Date.now()) / (24 * 60 * 60 * 1000))
    : null
  const canRefund = ticket.status === 'booked' && eventDate && eventDate.getTime() > Date.now()
  const refundAmountPounds = canRefund && (ticket.ticket_price_pence != null || ticket.booking_fee_pence != null)
    ? ((ticket.ticket_price_pence ?? Math.max(0, (ticket.price_pence ?? 0) - (ticket.booking_fee_pence ?? 0))) / 100).toFixed(2)
    : null
  const formattedDate = event.event_date
    ? formatEventDate(event.event_date, {
        weekday: 'long',
        year: 'numeric',
        month: 'long',
        day: 'numeric',
      })
    : ''
  const formattedTime = event.event_date ? formatEventTime(event.event_date) : ''

  // Clean location string for display - remove ", ," patterns and trailing commas
  const cleanLocationForDisplay = (location: string | null): string => {
    if (!location) return ''
    
    // Remove ", ," patterns (comma, space, comma, space) - this handles empty address line 2
    let cleaned = location.replace(/,\s*,\s*/g, ', ')
    
    // Remove trailing commas and spaces
    cleaned = cleaned.replace(/,\s*$/, '').trim()
    
    // Remove any double spaces
    cleaned = cleaned.replace(/\s+/g, ' ')
    
    return cleaned
  }

  const fullLocation = event.show_venue && event.location 
    ? cleanLocationForDisplay(event.location)
    : ''

  // Only fetch/show Stripe receipt when there was a real payment (not free/discount-only checkout)
  const showStripeReceipt =
    !!ticket.stripe_checkout_session_id &&
    !String(ticket.stripe_checkout_session_id).startsWith('free_') &&
    (ticket.price_pence ?? 0) > 0

  const openStripeReceipt = async () => {
    if (!ticket.stripe_checkout_session_id || receiptLoading) return
    setReceiptLoading(true)
    try {
      const url = await stripeApi.getReceiptUrl(ticket.stripe_checkout_session_id)
      window.open(url, '_blank', 'noopener,noreferrer')
    } catch (err: unknown) {
      toast.error(err instanceof Error ? err.message : 'Receipt not available')
    } finally {
      setReceiptLoading(false)
    }
  }

  return (
    <div className="bg-[#0B0B0D] rounded-xl shadow-sm p-6 border border-white/[0.12]">
      <div className="grid grid-cols-1 md:grid-cols-[40%_40%_20%] gap-6">
        {/* First Column - Event Details */}
        <div>
          <h3 className="text-xl font-semibold text-white mb-4">{event.name}</h3>
          
          <div className="space-y-2">
            {fullLocation && (
              <p className="text-sm text-white/65">
                {fullLocation}
              </p>
            )}
            {eventDate && (
              <>
                <p className="text-sm text-white/65">
                  <span className="font-medium">Date:</span> {formattedDate}
                </p>
                <p className="text-sm text-white/65">
                  <span className="font-medium">Time:</span> {formattedTime}
                  {event.event_duration && (
                    <span className="ml-2">
                      ({event.event_duration} {event.event_duration === 1 ? 'hour' : 'hours'})
                    </span>
                  )}
                </p>
              </>
            )}
          </div>
        </div>

        {/* Second Column - Price and Purchase Info */}
        <div>
          <div className="space-y-2">
            {fullLocation && (
              <div className="h-[1.25rem]"></div>
            )}
            <p className="text-sm text-white/65">
              <span className="font-medium">Price:</span>{' '}
              {(() => {
                const sym = event.currency === 'USD' ? '$' : '£'
                const paidPence = ticket.price_pence ?? 0
                const ticketPence = ticket.ticket_price_pence ?? Math.max(0, paidPence - (ticket.booking_fee_pence ?? 0))
                const discountPence = ticket.discount_amount_pence ?? 0
                const originalPence = ticket.original_ticket_price_pence ?? ((ticketPence + discountPence) || paidPence)
                const hadDiscount = discountPence > 0 || (ticket.original_ticket_price_pence != null && originalPence > ticketPence)
                if (hadDiscount) {
                  return (
                    <>
                      {sym}{(originalPence / 100).toFixed(2)}{' '}
                      <span className="text-white/50">
                        ({sym}{(discountPence / 100).toFixed(2)} discount applied → Paid: {sym}{(paidPence / 100).toFixed(2)})
                      </span>
                    </>
                  )
                }
                return <>{sym}{(paidPence / 100).toFixed(2)}</>
              })()}
            </p>
            <p className="text-sm text-white/65">
              <span className="font-medium">Purchased:</span> {new Date(ticket.transaction_date).toLocaleString('en-GB', { day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit' })}
            </p>
            <div className="h-2"></div>
            <div className="flex flex-col gap-2">
              {showStripeReceipt && (
                <button
                  type="button"
                  onClick={openStripeReceipt}
                  disabled={receiptLoading}
                  className="inline-block text-sm text-primary hover:underline font-medium disabled:opacity-50 disabled:cursor-not-allowed text-left"
                >
                  {receiptLoading ? 'Opening receipt…' : 'View Payment Receipt →'}
                </button>
              )}
              <button
                onClick={() => generateVatReceiptMutation.mutate()}
                disabled={generateVatReceiptMutation.isPending}
                className="inline-block text-sm text-primary hover:underline font-medium disabled:opacity-50 disabled:cursor-not-allowed text-left"
              >
                {generateVatReceiptMutation.isPending ? 'Generating...' : 'View VAT Invoice →'}
              </button>
              {showRefund && canRefund && (
                <button
                  type="button"
                  onClick={() => setShowRefundModal(true)}
                  className="inline-block text-sm text-amber-600 hover:text-amber-700 hover:underline font-medium text-left"
                >
                  Request Refund
                </button>
              )}
            </div>
            {ticket.checked_in && ticket.checked_in_at && (
              <p className="text-sm text-green-600 font-medium mt-2">
                ✓ Checked in: {new Date(ticket.checked_in_at).toLocaleDateString('en-GB')}
              </p>
            )}
          </div>
        </div>

        {/* Third Column - QR Code */}
        {ticket.qr_code_url && (
          <div className="flex flex-col items-center md:items-start gap-2">
            <img 
              src={ticket.qr_code_url} 
              alt="QR Code" 
              className="w-32 h-32 border-2 border-white/[0.12] rounded-lg" 
            />
            {showAddToGoogleWallet && (
              <Link
                to={`/wallet/google/${ticket.id}`}
                className="text-sm font-medium text-[#1a73e8] hover:underline"
              >
                Add to Google Wallet
              </Link>
            )}
            {showAddToAppleWallet && (
              <Link
                to={`/wallet/apple/${ticket.id}`}
                className="text-sm font-medium text-white hover:underline"
              >
                Add to Apple Wallet
              </Link>
            )}
          </div>
        )}
      </div>

      {/* Refund modal */}
      {showRefundModal && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/50"
          role="dialog"
          aria-modal="true"
          aria-labelledby="refund-modal-title"
          aria-describedby="refund-modal-desc"
          onClick={(e) => {
            if (e.target === e.currentTarget) {
              setShowRefundModal(false)
              setRefundReason('')
            }
          }}
        >
          <div className="bg-[#0B0B0D] rounded-xl shadow-xl max-w-md w-full min-w-0 max-h-[90vh] overflow-y-auto p-6">
            <div className="flex justify-between items-start gap-2 mb-2">
              <h3 id="refund-modal-title" className="text-lg font-semibold text-white pr-2">
                Request Refund
              </h3>
              <button
                type="button"
                className="text-white/50 hover:text-white/90 text-2xl leading-none min-h-[44px] min-w-[44px] shrink-0 inline-flex items-center justify-center rounded-lg focus-ring"
                aria-label="Close"
                onClick={() => {
                  setShowRefundModal(false)
                  setRefundReason('')
                }}
              >
                ×
              </button>
            </div>
            <p id="refund-modal-desc" className="text-sm text-white/65 mb-4">
              Refund policy: You can receive a refund if you cancel 28 days or more before the event.
            </p>
            {daysToEvent != null && daysToEvent >= 28 ? (
              <>
                <p className="text-sm text-white/75 mb-2">
                  You are <strong>{daysToEvent} days</strong> before the event. You are eligible for a <strong>money refund</strong>.
                </p>
                <p className="text-sm text-white/75 mb-4">
                  Refund amount: <strong>{event?.currency === 'USD' ? '$' : '£'}{refundAmountPounds ?? '0.00'}</strong> (booking fee is non-refundable).
                </p>
              </>
            ) : (
              <>
                <p className="text-sm text-white/75 mb-2">
                  There are fewer than 28 days until the event. Refunds are not possible, but a <strong>credit</strong> will be applied to your account.
                </p>
                <p className="text-sm text-white/75 mb-4">
                  You will receive a single-use discount code worth <strong>{event?.currency === 'USD' ? '$' : '£'}{refundAmountPounds ?? '0.00'}</strong> (the value of this booking) valid for your next booking, for 1 year.
                </p>
              </>
            )}
            <label htmlFor={`ticket-refund-reason-${ticket.id}`} className="block text-sm font-medium text-white/75 mb-1">
              Reason for cancellation (optional)
            </label>
            <textarea
              id={`ticket-refund-reason-${ticket.id}`}
              value={refundReason}
              onChange={(e) => setRefundReason(e.target.value)}
              rows={3}
              className="w-full px-3 py-2 border border-white/[0.15] rounded-lg input-focus-ring mb-4"
              placeholder="e.g. Change of plans"
            />
            <div className="flex flex-wrap gap-2 justify-end">
              <button
                type="button"
                onClick={() => {
                  setShowRefundModal(false)
                  setRefundReason('')
                }}
                className="px-4 py-2.5 min-h-[44px] border border-white/[0.15] rounded-lg text-white/75 hover:bg-[#070707] focus-ring"
              >
                Cancel
              </button>
              {daysToEvent != null && daysToEvent >= 28 ? (
                <button
                  type="button"
                  onClick={() => processRefundMutation.mutate()}
                  disabled={processRefundMutation.isPending}
                  className="btn-haus-fill focus-ring min-h-[44px] rounded-lg px-4 py-2.5 disabled:opacity-50"
                >
                  {processRefundMutation.isPending ? 'Processing...' : 'Process Refund'}
                </button>
              ) : (
                <button
                  type="button"
                  onClick={() => submitRefundClaimMutation.mutate()}
                  disabled={submitRefundClaimMutation.isPending}
                  className="btn-haus-fill focus-ring min-h-[44px] rounded-lg px-4 py-2.5 disabled:opacity-50"
                >
                  {submitRefundClaimMutation.isPending ? 'Submitting...' : 'Submit Refund Claim'}
                </button>
              )}
            </div>
          </div>
        </div>
      )}
      
      {/* Refer a Friend Section (Booked only) */}
      {showReferral && canReferFriend && (
        <div className="mt-6 pt-4 border-t border-white/[0.12]">
          {!showReferForm ? (
            <button
              onClick={() => setShowReferForm(true)}
              className="btn-haus-fill w-full rounded-lg px-4 py-2 text-sm transition-colors"
            >
              Refer a Friend
            </button>
          ) : (
            <form onSubmit={handleReferFriend} className="space-y-2">
              <input
                type="email"
                value={friendEmail}
                onChange={(e) => setFriendEmail(e.target.value)}
                placeholder="Enter friend's email"
                className="w-full px-3 py-2 border border-white/[0.15] rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-primary"
                required
              />
              <div className="flex gap-2">
                <button
                  type="submit"
                  disabled={createReferralMutation.isPending}
                  className="btn-haus-fill flex-1 rounded-lg px-4 py-2 text-sm transition-colors disabled:opacity-50"
                >
                  {createReferralMutation.isPending ? 'Sending...' : 'Send Referral'}
                </button>
                <button
                  type="button"
                  onClick={() => {
                    setShowReferForm(false)
                    setFriendEmail('')
                  }}
                  className="px-4 py-2 border border-white/[0.15] rounded-lg text-sm font-medium hover:bg-[#070707] transition-colors"
                >
                  Cancel
                </button>
              </div>
            </form>
          )}
        </div>
      )}
    </div>
  )
}

function PreRegistrationCard({ preRegistration }: { preRegistration: any }) {
  const event = preRegistration.events
  const formattedDateShort = event?.event_date
    ? formatEventDate(event.event_date, {
        weekday: 'short',
        day: 'numeric',
        month: 'short',
        year: 'numeric',
      })
    : ''
  const formattedTime = event?.event_date ? formatEventTime(event.event_date) : ''

  const statusRaw: string = event?.status || ''
  const statusLabel = statusRaw ? statusRaw.replace(/_/g, ' ') : 'unknown'
  const registrationCount = typeof event?.registration_count === 'number' ? event.registration_count : 0
  const minTarget = typeof event?.min_target === 'number' ? event.min_target : 0
  const isTargetMet = minTarget > 0 && registrationCount >= minTarget

  const interestPercent =
    statusRaw === 'collecting_interest' && minTarget > 0
      ? Math.max(0, Math.min(100, Math.round((registrationCount / minTarget) * 100)))
      : 0

  const statusBadgeClass =
    statusRaw === 'open'
      ? 'border-emerald-500/35 bg-emerald-500/15 text-emerald-200'
      : statusRaw === 'collecting_interest'
        ? 'border-[#8B5CF6]/40 bg-[#8B5CF6]/15 text-[#E9D5FF]'
        : 'border-white/15 bg-white/[0.06] text-white/70'

  return (
    <article className="flex h-full min-h-[220px] flex-col rounded-2xl border border-white/[0.1] bg-[#0B0B0D] p-5 shadow-[0_12px_40px_rgba(0,0,0,0.35)] transition hover:border-[#8B5CF6]/35">
      <div className="mb-3 flex items-start justify-between gap-2">
        <span className="inline-flex max-w-[65%] items-center rounded-full border border-white/[0.12] bg-white/[0.04] px-2.5 py-0.5 text-[10px] font-semibold uppercase tracking-wider text-white/55">
          Pre-registered
        </span>
        <span
          className={`shrink-0 rounded-full border px-2.5 py-0.5 text-[11px] font-medium capitalize ${statusBadgeClass}`}
        >
          {statusLabel}
        </span>
      </div>

      <h3 className="line-clamp-2 text-base font-semibold leading-snug text-white">{event?.name ?? 'Event'}</h3>
      <p className="mt-1.5 text-sm text-white/55">{event?.city}</p>

      {(formattedDateShort || formattedTime) && (
        <div className="mt-3 space-y-1 border-t border-white/[0.06] pt-3 text-xs text-white/50">
          {formattedDateShort && (
            <p className="flex items-center gap-2">
              <span className="text-white/35" aria-hidden>
                <svg className="h-3.5 w-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M8 7V3m8 4V3m-9 8h10M5 21h14a2 2 0 002-2V7a2 2 0 00-2-2H5a2 2 0 00-2 2v12a2 2 0 002 2z" />
                </svg>
              </span>
              {formattedDateShort}
              {formattedTime ? ` · ${formattedTime}` : ''}
            </p>
          )}
        </div>
      )}

      {statusRaw === 'collecting_interest' && minTarget > 0 && (
        <div className="mt-4">
          <div className="mb-1.5 flex items-center justify-between gap-2 text-[11px] text-white/60">
            <span className="font-medium text-[#A78BFA]">Interest</span>
            <span>
              {registrationCount}/{minTarget}
              <span className="ml-1 text-white/45">({interestPercent}%)</span>
            </span>
          </div>
          <div className="h-2 w-full overflow-hidden rounded-full bg-white/[0.08]">
            <div
              className="h-full rounded-full bg-[#8B5CF6] transition-all"
              style={{ width: `${interestPercent}%` }}
              aria-label={`Interest ${interestPercent}%`}
            />
          </div>
        </div>
      )}

      <div className="mt-auto flex flex-col gap-2 pt-5">
        {isTargetMet && (
          <Link
            to={`/events/${event.id}`}
            className="btn-haus-fill flex w-full items-center justify-center rounded-xl px-4 py-2.5 text-center text-sm"
          >
            Book now
          </Link>
        )}
        <Link
          to={`/events/${event.id}`}
          className="text-center text-sm font-medium text-[#A78BFA] transition hover:text-[#C4B5FD] hover:underline"
        >
          View event
        </Link>
      </div>
    </article>
  )
}

function Pagination({
  currentPage,
  totalPages,
  onPageChange,
  totalItems,
  itemsPerPage,
}: {
  currentPage: number
  totalPages: number
  onPageChange: (page: number) => void
  totalItems: number
  itemsPerPage: number
}) {
  const startItem = (currentPage - 1) * itemsPerPage + 1
  const endItem = Math.min(currentPage * itemsPerPage, totalItems)

  return (
    <div className="flex flex-col sm:flex-row items-center justify-between gap-4 mt-6 bg-[#0B0B0D] rounded-xl shadow-sm p-4 border border-white/[0.12]">
      <div className="text-sm text-white/75">
        Showing <span className="font-medium">{startItem}</span> to <span className="font-medium">{endItem}</span> of{' '}
        <span className="font-medium">{totalItems}</span> results
      </div>
      <div className="flex gap-2">
        <button
          onClick={() => onPageChange(currentPage - 1)}
          disabled={currentPage === 1}
          className="px-4 py-2 text-sm font-medium text-white/75 bg-[#0B0B0D] border border-white/[0.15] rounded-lg hover:bg-[#070707] disabled:opacity-50 disabled:cursor-not-allowed"
          aria-label={`Go to previous page, page ${currentPage - 1}`}
        >
          Previous
        </button>
        <div className="flex gap-1">
          {Array.from({ length: totalPages }, (_, i) => i + 1)
            .filter((page) => {
              // Show first page, last page, current page, and pages around current
              return (
                page === 1 ||
                page === totalPages ||
                (page >= currentPage - 1 && page <= currentPage + 1)
              )
            })
            .map((page, index, array) => {
              // Add ellipsis if there's a gap
              const showEllipsisBefore = index > 0 && array[index] - array[index - 1] > 1
              return (
                <div key={page} className="flex items-center gap-1">
                  {showEllipsisBefore && (
                    <span className="px-2 text-white/50">...</span>
                  )}
                  <button
                    onClick={() => onPageChange(page)}
                    className={`rounded-lg px-3 py-2 text-sm font-medium ${
                      currentPage === page
                        ? 'btn-haus-fill'
                        : 'btn-haus-ghost text-white/75'
                    }`}
                    aria-label={`Go to page ${page}`}
                    aria-current={currentPage === page ? 'page' : undefined}
                  >
                    {page}
                  </button>
                </div>
              )
            })}
        </div>
        <button
          onClick={() => onPageChange(currentPage + 1)}
          disabled={currentPage === totalPages}
          className="px-4 py-2 text-sm font-medium text-white/75 bg-[#0B0B0D] border border-white/[0.15] rounded-lg hover:bg-[#070707] disabled:opacity-50 disabled:cursor-not-allowed"
          aria-label={`Go to next page, page ${currentPage + 1}`}
        >
          Next
        </button>
      </div>
    </div>
  )
}
