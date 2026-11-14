import { Component, OnInit, OnDestroy } from '@angular/core';
import { HttpClient, HttpHeaders } from '@angular/common/http';
import { ToastController, AlertController, LoadingController } from '@ionic/angular';
import { io, Socket } from 'socket.io-client';
import { Subscription } from 'rxjs';
import { environment } from '../../../environments/environment';
import { AuthService } from '../../services/auth.service';
import { ChatService } from '../../services/chat.service';
import { SOPService, OrderSOPData, SOPServiceItem, SOPSubtask, SubtaskProofImage } from '../../services/sop.service';

@Component({
    selector: 'app-vendor-portal',
    templateUrl: './vendor-portal.page.html',
    styleUrls: ['./vendor-portal.page.scss'],
})
export class VendorPortalPage implements OnInit, OnDestroy {
    // Auth flow state
    isLoggedIn = false;
    authStep: 'mobile' | 'otp' | 'signup' = 'mobile';
    vendorMobile = '';
    otpCode = '';
    isAuthenticating = false;
    /** True while the API runs with demo OTPs (1234); false once real SMS OTPs are on. */
    otpDemoMode = true;
    isSendingSignupOtp = false;
    isUploadingPhoto = false;

    currentVendor: any = null;
    vendorToken: string | null = null;

    // Signup form state (mirrors Admin Add Vendor modal)
    signupData = {
        name: '',
        mobile: '',
        email: '',
        image: '',
        status: 'active',
        services: [] as number[],
        otp: ''
    };
    availableSubcategories: any[] = [];
    selectedSubcategoryIds: number[] = [];

    // Authenticated dashboard tabs: orders | notifications | chat | profile | sop
    activeTab: 'orders' | 'notifications' | 'chat' | 'profile' | 'sop' = 'orders';
    orderFilter: 'all' | 'pending' | 'in_progress' | 'completed' = 'all';

    // Dashboard Data
    orders: any[] = [];
    notifications: any[] = [];
    conversations: any[] = [];
    loadingOrders = false;
    loadingNotifications = false;
    loadingConversations = false;
    processingId: number | null = null;

    // Real-time Chat Drawer State
    showChatPanel = false;
    chatInitialOrderId: number | string | null = null;
    chatInitialViewTab: 'chat' | 'sop' = 'chat';
    isChatDisabledForCurrentOrder = false;

    // SOP Sequence Tab State
    sopOrders: any[] = [];
    selectedSopOrderId: number | string | null = null;
    sopData: OrderSOPData | null = null;
    selectedSopService: SOPServiceItem | null = null;
    loadingSop = false;

    // Add Sub Task Modal
    showAddSubtaskModal = false;
    targetServiceForSubtask: SOPServiceItem | null = null;
    newSubtask: { title: string; description: string; start_date: string; end_date: string; next_order_service_id: number | null } = {
        title: '',
        description: '',
        start_date: '',
        end_date: '',
        next_order_service_id: null
    };
    isSavingSubtask = false;

    // Subtask Details & Proof Upload Modal
    showSubtaskDetailsModal = false;
    selectedSubtask: SOPSubtask | null = null;
    selectedSubtaskService: SOPServiceItem | null = null;
    isUploadingProof = false;
    previewImageUrl: string | null = null;

    // Raise Completion Request Modal
    showRaiseCompletionModal = false;
    targetServiceForCompletion: SOPServiceItem | null = null;
    completionNote = '';
    isRaisingCompletion = false;

    // Notification Badge Tracking for Opened Tabs
    private seenOrderIds = new Set<number>();
    private lastSeenChatTime = 0;

    // Socket.io connection for real-time order & removal events
    private socket: Socket | null = null;

    constructor(
        private http: HttpClient,
        private toastCtrl: ToastController,
        private alertCtrl: AlertController,
        private loadingCtrl: LoadingController,
        private authService: AuthService,
        private chatService: ChatService,
        private sopService: SOPService
    ) { }

    ngOnInit() {
        this.loadServiceSubcategories();
        this.checkExistingSession();
    }

    ngOnDestroy() {
        if (this.socket) {
            this.socket.disconnect();
        }
    }

    private getHeaders() {
        return new HttpHeaders({
            Authorization: `Bearer ${this.vendorToken}`
        });
    }

    // ── Authentication & Enlistment Workflow ──

    checkExistingSession() {
        const token = localStorage.getItem('civilworks_vendor_token') || localStorage.getItem('civilworks_token');
        const vendorData = localStorage.getItem('civilworks_vendor_user') || localStorage.getItem('civilworks_user');
        if (token && vendorData) {
            try {
                this.vendorToken = token;
                this.currentVendor = JSON.parse(vendorData);
                this.isLoggedIn = true;

                const vendorUser = {
                    id: this.currentVendor.id,
                    name: this.currentVendor.name,
                    mobile: this.currentVendor.mobile,
                    email: this.currentVendor.email,
                    role: 'vendor',
                    vendor_id: this.currentVendor.id,
                    status: this.currentVendor.status
                };
                localStorage.setItem('civilworks_vendor_token', this.vendorToken!);
                localStorage.setItem('civilworks_vendor_user', JSON.stringify(this.currentVendor));
                localStorage.setItem('civilworks_token', this.vendorToken!);
                localStorage.setItem('civilworks_user', JSON.stringify(vendorUser));
                this.authService.setSession(vendorUser, this.vendorToken!);

                this.loadSeenOrderIds();
                this.loadSeenChatTime();
                this.initVendorSocket();
                this.loadDashboardData();
            } catch (e) {
                this.logout();
            }
        }
    }

    loadServiceSubcategories() {
        this.http.get<any>(`${environment.apiUrl}/vendor-portal/subcategories`).subscribe({
            next: (res) => {
                this.availableSubcategories = res.data || [];
            },
            error: (err) => console.warn('Could not load service subcategories for signup', err)
        });
    }

    async submitMobileCheck() {
        const clean = this.vendorMobile.replace(/\D/g, '').slice(-10);
        if (!clean || clean.length < 10) {
            this.showToast('Please enter a valid 10-digit mobile number', 'warning');
            return;
        }

        this.isAuthenticating = true;
        this.http.post<any>(`${environment.apiUrl}/vendor-portal/check-mobile`, {
            mobile: clean
        }).subscribe({
            next: (res) => {
                this.isAuthenticating = false;
                const data = res.data;
                this.otpDemoMode = !!data.otp;
                if (data.exists) {
                    // Vendor is already enlisted in the system -> trigger OTP verification login!
                    this.currentVendor = data.vendor;
                    this.authStep = 'otp';
                    this.otpCode = '';
                    this.showToast(`Welcome back, ${data.vendor.name}! Verification OTP sent to +91 ${clean}${this.otpDemoMode ? ' (Default: 1234)' : ''}`, 'success');
                } else {
                    // Vendor not yet enlisted -> switch to Sign Up form with all details
                    this.signupData.mobile = clean;
                    this.signupData.otp = '';
                    this.selectedSubcategoryIds = [];
                    this.authStep = 'signup';
                    this.showToast(this.otpDemoMode ? `New partner mobile detected. Please complete your registration details below.` : `New partner mobile detected. We sent an OTP to +91 ${clean}; enter it in the form below.`, 'primary');
                }
            },
            error: (err) => {
                this.isAuthenticating = false;
                this.showToast(err.error?.message || 'Failed to verify mobile number', 'danger');
            }
        });
    }

    submitOtpLogin() {
        if (!this.otpCode.trim()) {
            this.showToast('Please enter the 4-digit OTP', 'warning');
            return;
        }

        const clean = this.vendorMobile.replace(/\D/g, '').slice(-10);
        this.isAuthenticating = true;

        this.http.post<any>(`${environment.apiUrl}/vendor-portal/verify-otp`, {
            mobile: clean,
            otp: this.otpCode.trim()
        }).subscribe({
            next: (res) => {
                this.isAuthenticating = false;
                this.completeAuthSuccess(res.data);
            },
            error: (err) => {
                this.isAuthenticating = false;
                this.showToast(err.error?.message || 'Invalid OTP code. Please try again.', 'danger');
            }
        });
    }

    onFileSelected(event: any) {
        const file = event.target.files?.[0];
        if (!file) return;

        this.isUploadingPhoto = true;
        const formData = new FormData();
        formData.append('image', file);

        this.http.post<any>(`${environment.apiUrl}/vendor-portal/upload`, formData).subscribe({
            next: (res) => {
                this.isUploadingPhoto = false;
                this.signupData.image = res.data.url;
                this.showToast('Logo/Photo uploaded successfully', 'success');
            },
            error: (err) => {
                this.isUploadingPhoto = false;
                this.showToast('Failed to upload image. Please try again.', 'danger');
            }
        });
    }

    isSubcategorySelected(subId: number): boolean {
        return this.selectedSubcategoryIds.includes(subId);
    }

    toggleSubcategory(subId: number) {
        const idx = this.selectedSubcategoryIds.indexOf(subId);
        if (idx > -1) {
            this.selectedSubcategoryIds.splice(idx, 1);
        } else {
            this.selectedSubcategoryIds.push(subId);
        }
        this.signupData.services = [...this.selectedSubcategoryIds];
    }

    async submitSignup() {
        if (!this.signupData.name.trim()) {
            this.showToast('Vendor name is required', 'warning');
            return;
        }
        if (!this.signupData.mobile.trim()) {
            this.showToast('Mobile number is required', 'warning');
            return;
        }
        if (this.selectedSubcategoryIds.length === 0) {
            this.showToast('Please select at least one service subcategory provided', 'warning');
            return;
        }

        const clean = this.signupData.mobile.replace(/\D/g, '').slice(-10);
        this.isAuthenticating = true;

        const payload = {
            name: this.signupData.name.trim(),
            mobile: clean,
            email: this.signupData.email ? this.signupData.email.trim() : null,
            image: this.signupData.image || null,
            status: this.signupData.status || 'active',
            services: this.selectedSubcategoryIds,
            otp: this.signupData.otp ? this.signupData.otp.trim() : (this.otpDemoMode ? '1234' : '')
        };

        this.http.post<any>(`${environment.apiUrl}/vendor-portal/signup`, payload).subscribe({
            next: (res) => {
                this.isAuthenticating = false;
                this.completeAuthSuccess(res.data);
                this.showToast(`🎉 Registration successful! Welcome to CivilWorks, ${res.data.vendor.name}.`, 'success');
            },
            error: (err) => {
                this.isAuthenticating = false;
                this.showToast(err.error?.message || 'Registration failed. Please check your details.', 'danger');
            }
        });
    }

    switchToLogin() {
        this.authStep = 'mobile';
        this.otpCode = '';
    }

    switchToSignup() {
        this.authStep = 'signup';
        if (this.vendorMobile && !this.signupData.mobile) {
            this.signupData.mobile = this.vendorMobile.replace(/\D/g, '').slice(-10);
        }
        if (!this.signupData.otp && this.otpDemoMode) {
            this.signupData.otp = '1234';
        }
    }

    /** Send (or resend) the verification OTP for a new vendor signing up. */
    sendSignupOtp() {
        const clean = (this.signupData.mobile || '').replace(/\D/g, '').slice(-10);
        if (clean.length < 10) {
            this.showToast('Enter your 10-digit mobile number first', 'warning');
            return;
        }
        this.isSendingSignupOtp = true;
        this.http.post<any>(`${environment.apiUrl}/vendor-portal/send-otp`, { mobile: clean }).subscribe({
            next: (res) => {
                this.isSendingSignupOtp = false;
                this.otpDemoMode = !!res.data?.otp;
                if (!this.otpDemoMode && this.signupData.otp === '1234') this.signupData.otp = '';
                this.showToast(this.otpDemoMode ? 'Demo mode: use OTP 1234' : `OTP sent to +91 ${clean}`, 'success');
            },
            error: (err) => {
                this.isSendingSignupOtp = false;
                this.showToast(err.error?.message || 'Could not send the OTP. Please try again.', 'danger');
            }
        });
    }

    resetAuth() {
        this.switchToLogin();
        this.signupData = {
            name: '',
            mobile: '',
            email: '',
            image: '',
            status: 'active',
            services: [],
            otp: ''
        };
        this.selectedSubcategoryIds = [];
    }

    private completeAuthSuccess(data: any) {
        this.vendorToken = data.token;
        this.currentVendor = data.vendor;
        this.isLoggedIn = true;

        const vendorUser = {
            id: this.currentVendor.id,
            name: this.currentVendor.name,
            mobile: this.currentVendor.mobile,
            email: this.currentVendor.email,
            role: 'vendor',
            vendor_id: this.currentVendor.id,
            status: this.currentVendor.status
        };
        localStorage.setItem('civilworks_vendor_token', this.vendorToken!);
        localStorage.setItem('civilworks_vendor_user', JSON.stringify(this.currentVendor));
        localStorage.setItem('civilworks_token', this.vendorToken!);
        localStorage.setItem('civilworks_user', JSON.stringify(vendorUser));
        this.authService.setSession(vendorUser, this.vendorToken!);

        this.loadSeenOrderIds();
        this.loadSeenChatTime();
        this.initVendorSocket();
        this.loadDashboardData();
    }

    logout() {
        this.isLoggedIn = false;
        this.currentVendor = null;
        this.vendorToken = null;
        this.orders = [];
        this.notifications = [];
        this.conversations = [];
        this.seenOrderIds.clear();
        this.lastSeenChatTime = 0;
        this.resetAuth();

        localStorage.removeItem('civilworks_vendor_token');
        localStorage.removeItem('civilworks_vendor_user');
        localStorage.removeItem('civilworks_token');
        localStorage.removeItem('civilworks_user');
        this.authService.logout();

        if (this.socket) {
            this.socket.disconnect();
            this.socket = null;
        }
    }

    // ── Real-time Socket Setup ──

    private initVendorSocket() {
        if (!this.currentVendor) return;
        const socketHost = environment.apiUrl.replace(/\/api\/v1\/?$/, '');

        try {
            this.socket = io(socketHost, {
                transports: ['websocket', 'polling'],
                reconnection: true
            });

            this.socket.on('connect', () => {
                console.log('[VendorPortal] Connected to real-time events');
                if (this.currentVendor?.id) {
                    this.socket?.emit('join_vendor', this.currentVendor.id);
                }
            });

            // Listen for incoming new service requests in real time
            this.socket.on('new_service_request', (payload: any) => {
                if (!payload || !this.currentVendor?.id || Number(payload.vendor_id) === Number(this.currentVendor.id)) {
                    console.log('[VendorPortal] New service request received:', payload);
                    this.loadOrders();
                    this.loadNotifications();
                }
            });

            // Listen for removal from project order
            this.socket.on('participant_removed', (payload: any) => {
                if (payload && Number(payload.vendor_id) === Number(this.currentVendor?.id)) {
                    console.warn('[VendorPortal] Removed from project conversation:', payload.conversation_id);
                    this.showToast('⚠️ You have been removed from this project order by the customer. Messaging is disabled.', 'danger');
                    this.loadOrders();
                    this.loadConversations();
                }
            });

            this.socket.on('service_removed', (payload: any) => {
                if (!payload || Number(payload.vendor_id) === Number(this.currentVendor?.id)) {
                    this.showToast('Notice: A service assignment was modified by the customer.', 'warning');
                    this.loadOrders();
                    this.loadConversations();
                }
            });

            this.socket.on('new_message', () => {
                this.loadConversations();
            });

            this.socket.on('conversation_message_received', () => {
                this.loadConversations();
            });

            this.socket.on('vendor_status_updated', () => {
                this.loadOrders();
                this.loadConversations();
                if (this.activeTab === 'sop') {
                    this.loadOrderSOP(this.selectedSopOrderId);
                }
            });

            this.socket.on('work_status_updated', () => {
                this.loadOrders();
                this.loadConversations();
                if (this.activeTab === 'sop') {
                    this.loadOrderSOP(this.selectedSopOrderId);
                }
            });

            this.socket.on('order_completed', () => {
                this.loadOrders();
                this.loadConversations();
                this.loadNotifications();
                if (this.activeTab === 'sop') {
                    this.loadOrderSOP(this.selectedSopOrderId);
                }
            });

            this.socket.on('notification_received', () => {
                this.loadNotifications();
                this.loadOrders();
            });

            this.socket.on('new_notification', () => {
                this.loadNotifications();
                this.loadOrders();
            });

            this.socket.on('vendor_notification_updated', () => {
                this.loadNotifications();
                this.loadOrders();
            });

            const sopEvents = [
                'sop_subtask_completed',
                'sop_proof_uploaded',
                'sop_completion_requested',
                'sop_completion_responded',
                'sop_subtask_created',
                'sop_subtask_updated',
                'sop_subtasks_reordered',
                'sop_subtask_deleted',
                'sop_service_updated',
                'sop_sequence_updated'
            ];
            sopEvents.forEach(evt => {
                this.socket?.on(evt, (payload: any) => {
                    this.loadNotifications();
                    if (this.activeTab === 'sop') {
                        const curId = this.selectedSopOrderId || this.sopData?.id;
                        const evtId = payload?.orderId || payload?.order_id;
                        if (!evtId || !curId || Number(evtId) === Number(curId)) {
                            this.loadOrderSOP(this.selectedSopOrderId);
                        }
                    }
                });
            });
        } catch (e) {
            console.warn('Socket connection error in vendor portal', e);
        }
    }

    // ── Dashboard Data Loading ──

    loadDashboardData() {
        this.loadOrders();
        this.loadNotifications();
        this.loadConversations();
    }

    loadOrders() {
        if (!this.vendorToken) return;
        this.loadingOrders = true;

        this.http.get<any>(`${environment.apiUrl}/vendor-portal/requests`, {
            headers: this.getHeaders()
        }).subscribe({
            next: (res) => {
                this.orders = res.data || [];
                if (this.activeTab === 'orders') {
                    this.markOrdersSeen();
                }
                this.loadingOrders = false;
            },
            error: (err) => {
                console.error('Failed to load vendor orders', err);
                this.loadingOrders = false;
            }
        });
    }

    openOrdersTab() {
        this.activeTab = 'orders';
        this.markOrdersSeen();
    }

    openNotificationsTab() {
        this.activeTab = 'notifications';
        // Immediately mark local notifications as read so badge disappears
        this.notifications = this.notifications.map(n => ({ ...n, is_read: true }));
        this.http.post<any>(`${environment.apiUrl}/vendor-portal/notifications/mark-read`, {}, {
            headers: this.getHeaders()
        }).subscribe({
            next: () => {
                this.loadNotifications();
            },
            error: () => {
                this.loadNotifications();
            }
        });
    }

    openChatsTab() {
        this.activeTab = 'chat';
        this.markChatsSeen();
    }

    loadNotifications() {
        if (!this.vendorToken) return;
        this.loadingNotifications = true;

        this.http.get<any>(`${environment.apiUrl}/vendor-portal/notifications`, {
            headers: this.getHeaders()
        }).subscribe({
            next: (res) => {
                const list = res.data || [];
                if (this.activeTab === 'notifications') {
                    this.notifications = list.map((n: any) => ({ ...n, is_read: true }));
                } else {
                    this.notifications = list;
                }
                this.loadingNotifications = false;
            },
            error: (err) => {
                console.error('Failed to load vendor notifications', err);
                this.loadingNotifications = false;
            }
        });
    }

    loadConversations() {
        if (!this.vendorToken) return;
        this.loadingConversations = true;

        this.http.get<any>(`${environment.apiUrl}/vendor-portal/conversations`, {
            headers: this.getHeaders()
        }).subscribe({
            next: (res) => {
                this.conversations = res.data || [];
                if (this.activeTab === 'chat') {
                    this.markChatsSeen();
                }
                this.loadingConversations = false;
            },
            error: (err) => {
                console.error('Failed to load vendor conversations', err);
                this.loadingConversations = false;
            }
        });
    }

    // ── Order Acceptance & Gated Workflow ──

    async acceptOrderRequest(item: any) {
        const loading = await this.loadingCtrl.create({
            message: 'Accepting service request...',
            spinner: 'crescent'
        });
        await loading.present();

        this.http.post<any>(`${environment.apiUrl}/vendor-portal/requests/${item.id}/accept`, {}, {
            headers: this.getHeaders()
        }).subscribe({
            next: async (res) => {
                await loading.dismiss();
                item.vendor_status = 'accepted';
                item.service_status = 'in_progress';
                if (res.data?.customer) {
                    item.customer = res.data.customer;
                }
                item.conversation_id = res.data?.conversation_id;

                const alert = await this.alertCtrl.create({
                    header: 'Service Request Accepted! 🎉',
                    subHeader: `Project #${item.order_no}`,
                    message: `You are now joined in the live Project Communication Group with the customer. Customer contact details are now unlocked.`,
                    buttons: [
                        {
                            text: 'View Project Discussions',
                            handler: () => {
                                this.openChatForOrder(item);
                            }
                        },
                        {
                            text: 'Close',
                            role: 'cancel'
                        }
                    ]
                });
                await alert.present();

                this.loadOrders();
                this.loadNotifications();
                this.loadConversations();
            },
            error: async (err) => {
                await loading.dismiss();
                const msg = err.error?.message || 'Failed to accept service request';
                this.showToast(msg, 'danger');
            }
        });
    }

    async confirmRejectOrderRequest(item: any) {
        const alert = await this.alertCtrl.create({
            header: 'Decline Service Request?',
            subHeader: `Project #${item.order_no}`,
            message: `Are you sure you want to decline "${item.service_name || item.subcategory_name}"? The customer will be informed and can choose another verified vendor.`,
            buttons: [
                {
                    text: 'Cancel',
                    role: 'cancel'
                },
                {
                    text: 'Decline',
                    role: 'destructive',
                    handler: () => {
                        this.executeRejectOrder(item);
                    }
                }
            ]
        });
        await alert.present();
    }

    private executeRejectOrder(item: any) {
        this.processingId = item.id;
        this.http.post<any>(`${environment.apiUrl}/vendor-portal/requests/${item.id}/reject`, {}, {
            headers: this.getHeaders()
        }).subscribe({
            next: () => {
                this.processingId = null;
                item.vendor_status = 'rejected';
                this.showToast(`Declined request for Project #${item.order_no}.`, 'warning');
                this.loadOrders();
                this.loadNotifications();
            },
            error: (err) => {
                this.processingId = null;
                this.showToast(err.error?.message || 'Failed to decline request', 'danger');
            }
        });
    }

    openChatForOrder(orderItem: any) {
        if (orderItem.is_removed) {
            this.showToast('You have been removed from this project order. Messaging is disabled.', 'danger');
            return;
        }
        if (orderItem.vendor_status !== 'accepted') {
            this.showToast('You must accept the service request first to participate in Project Discussions.', 'warning');
            return;
        }

        this.chatInitialOrderId = orderItem.order_no || orderItem.order_id;
        this.chatInitialViewTab = 'chat';
        this.chatService.loadConversations().subscribe({ error: () => {} });
        this.showChatPanel = true;
    }

    openSopForOrder(orderItem: any) {
        if (orderItem.is_removed) {
            this.showToast('You have been removed from this project order.', 'danger');
            return;
        }
        if (orderItem.vendor_status !== 'accepted') {
            this.showToast('You must accept the service request first to access the sequence of operations.', 'warning');
            return;
        }

        this.chatInitialOrderId = orderItem.order_no || orderItem.order_id;
        this.chatInitialViewTab = 'sop';
        this.chatService.loadConversations().subscribe({ error: () => {} });
        this.showChatPanel = true;
    }

    openConversation(conv: any) {
        this.chatInitialOrderId = conv.order_no || conv.order_id;
        this.chatInitialViewTab = 'chat';
        this.chatService.loadConversations().subscribe({ error: () => {} });
        this.showChatPanel = true;
    }

    acceptRequestFromNotif(n: any) {
        if (!n.service_req_id) {
            this.activeTab = 'orders';
            this.orderFilter = 'pending';
            return;
        }

        const item = {
            id: n.service_req_id,
            order_id: n.order_id,
            order_no: n.order_no,
            service_name: n.service_name,
            subcategory_name: n.subcategory_name
        };

        this.acceptOrderRequest(item);
        n.vendor_status = 'accepted';
        n.title = `Service Request Accepted: ${n.subcategory_name || n.service_name}`;
    }

    confirmDeclineRequestFromNotif(n: any) {
        if (!n.service_req_id) {
            this.activeTab = 'orders';
            this.orderFilter = 'pending';
            return;
        }

        this.alertCtrl.create({
            header: 'Decline Service Request?',
            subHeader: `Project #${n.order_no}`,
            message: `Are you sure you want to decline "${n.service_name || n.subcategory_name}"? The customer will be informed and can choose another verified vendor.`,
            buttons: [
                {
                    text: 'Cancel',
                    role: 'cancel'
                },
                {
                    text: 'Decline',
                    role: 'destructive',
                    handler: () => {
                        this.processingId = n.service_req_id;
                        this.http.post<any>(`${environment.apiUrl}/vendor-portal/requests/${n.service_req_id}/reject`, {}, {
                            headers: this.getHeaders()
                        }).subscribe({
                            next: () => {
                                this.processingId = null;
                                n.vendor_status = 'rejected';
                                n.title = `Service Request Declined: ${n.subcategory_name || n.service_name}`;
                                this.showToast(`Declined request for Project #${n.order_no}.`, 'warning');
                                this.loadOrders();
                                this.loadNotifications();
                            },
                            error: (err) => {
                                this.processingId = null;
                                this.showToast(err.error?.message || 'Failed to decline request', 'danger');
                            }
                        });
                    }
                }
            ]
        }).then(alert => alert.present());
    }

    openChatForNotif(n: any) {
        if (!n.order_no && !n.order_id) return;
        this.chatInitialOrderId = n.order_no || n.order_id;
        this.chatService.loadConversations().subscribe({ error: () => {} });
        this.showChatPanel = true;
    }

    get filteredOrders(): any[] {
        if (this.orderFilter === 'pending') {
            return this.orders.filter(o => o.vendor_status === 'pending' && !o.is_removed);
        }
        if (this.orderFilter === 'in_progress') {
            return this.orders.filter(o => o.vendor_status === 'accepted' && !o.is_removed);
        }
        if (this.orderFilter === 'completed') {
            return this.orders.filter(o => o.service_status === 'completed' || o.is_removed);
        }
        return this.orders;
    }

    get pendingOrdersCount(): number {
        return this.orders.filter(o => o.vendor_status === 'pending' && !o.is_removed).length;
    }

    // Seen tracking methods for badges
    private loadSeenOrderIds() {
        if (!this.currentVendor) return;
        try {
            const raw = localStorage.getItem(`seen_orders_vendor_${this.currentVendor.id}`);
            if (raw) {
                const arr = JSON.parse(raw);
                this.seenOrderIds = new Set(arr);
            }
        } catch (e) {
            this.seenOrderIds = new Set();
        }
    }

    private markOrdersSeen() {
        if (!this.currentVendor) return;
        this.orders.forEach(o => this.seenOrderIds.add(o.id));
        try {
            localStorage.setItem(`seen_orders_vendor_${this.currentVendor.id}`, JSON.stringify(Array.from(this.seenOrderIds)));
        } catch (e) {}
    }

    get newOrdersCount(): number {
        if (this.activeTab === 'orders') return 0;
        return this.orders.filter(o => !this.seenOrderIds.has(o.id)).length;
    }

    private loadSeenChatTime() {
        if (!this.currentVendor) return;
        try {
            const raw = localStorage.getItem(`seen_chats_vendor_${this.currentVendor.id}`);
            if (raw) {
                this.lastSeenChatTime = Number(raw) || 0;
            } else {
                this.lastSeenChatTime = Date.now();
                localStorage.setItem(`seen_chats_vendor_${this.currentVendor.id}`, String(this.lastSeenChatTime));
            }
        } catch (e) {
            this.lastSeenChatTime = Date.now();
        }
    }

    private markChatsSeen() {
        if (!this.currentVendor) return;
        this.lastSeenChatTime = Date.now();
        try {
            localStorage.setItem(`seen_chats_vendor_${this.currentVendor.id}`, String(this.lastSeenChatTime));
        } catch (e) {}
    }

    get unreadChatsCount(): number {
        if (this.activeTab === 'chat') return 0;
        return this.conversations.filter(c => {
            const unread = Number(c.unread_count) || 0;
            if (unread > 0) return true;
            if (c.last_message_at && this.lastSeenChatTime) {
                const msgTime = new Date(c.last_message_at).getTime();
                if (msgTime > this.lastSeenChatTime) return true;
            }
            return false;
        }).length;
    }

    get unreadNotificationsCount(): number {
        if (this.activeTab === 'notifications') return 0;
        return this.notifications.filter(n => !n.is_read).length;
    }

    hasSubtaskProof(): boolean {
        if (!this.selectedSubtask) return false;
        if (this.selectedSubtask.proof_image_url) return true;
        return !!(this.selectedSubtask.proof_images && this.selectedSubtask.proof_images.length > 0);
    }

    getSubtaskProofImages(): SubtaskProofImage[] {
        if (!this.selectedSubtask) return [];
        if (this.selectedSubtask.proof_images && this.selectedSubtask.proof_images.length > 0) {
            return this.selectedSubtask.proof_images;
        }
        if (this.selectedSubtask.proof_image_url) {
            return [{
                id: 0,
                subtask_id: this.selectedSubtask.id,
                image_url: this.selectedSubtask.proof_image_url,
                original_name: 'Proof'
            }];
        }
        return [];
    }

    formatImageUrl(img: string): string {
        if (!img) return '';
        if (img.startsWith('http://') || img.startsWith('https://') || img.startsWith('data:')) {
            return img;
        }
        const clean = img.startsWith('/') ? img : `/${img}`;
        const baseOrigin = environment.uploadUrl.replace(/\/uploads\/?$/, '');
        if (clean.startsWith('/uploads/')) {
            return `${baseOrigin}${clean}`;
        }
        return `${environment.uploadUrl}${clean}`;
    }

    private async showToast(message: string, color: string = 'dark') {
        const toast = await this.toastCtrl.create({
            message,
            duration: 3500,
            color,
            position: 'top'
        });
        toast.present();
    }

    // ── SOP (Sequence of Operations) Workflow ──

    openSopTab(orderId?: any) {
        this.activeTab = 'sop';
        if (orderId) {
            this.selectedSopOrderId = orderId;
        }
        this.loadSopOrders();
    }

    loadSopOrders() {
        this.loadingSop = true;
        this.sopService.getEligibleOrders().subscribe({
            next: (orders) => {
                this.sopOrders = orders || [];
                if (this.sopOrders.length > 0) {
                    if (!this.selectedSopOrderId) {
                        this.selectedSopOrderId = this.sopOrders[0].order_no || this.sopOrders[0].id;
                    } else {
                        const exists = this.sopOrders.some(o => o.order_no == this.selectedSopOrderId || o.id == this.selectedSopOrderId);
                        if (!exists) {
                            this.selectedSopOrderId = this.sopOrders[0].order_no || this.sopOrders[0].id;
                        }
                    }
                    this.loadOrderSOP(this.selectedSopOrderId);
                } else {
                    this.loadingSop = false;
                }
            },
            error: (err) => {
                console.error('Failed to load vendor SOP orders:', err);
                this.loadingSop = false;
            }
        });
    }

    loadOrderSOP(orderId: number | string | null) {
        if (!orderId) return;
        this.loadingSop = true;
        this.sopService.getOrderSOP(orderId).subscribe({
            next: (data) => {
                this.sopData = data;
                if (this.sopData?.services && this.sopData.services.length > 0) {
                    if (this.selectedSopService) {
                        const found = this.sopData.services.find(s => s.id === this.selectedSopService!.id);
                        this.selectedSopService = found || this.sopData.services[0];
                    } else {
                        const inProg = this.sopData.services.find(s => s.service_status === 'in_progress');
                        this.selectedSopService = inProg || this.sopData.services[0];
                    }
                } else {
                    this.selectedSopService = null;
                }
                this.loadingSop = false;
            },
            error: (err) => {
                console.error('Failed to load SOP details for vendor:', err);
                this.loadingSop = false;
                this.showToast(err?.error?.message || 'Could not load Site Workflow details.', 'danger');
            }
        });
    }

    onSopOrderChange(orderId: any) {
        this.selectedSopOrderId = orderId;
        this.selectedSopService = null;
        this.loadOrderSOP(this.selectedSopOrderId);
    }

    selectSopService(service: SOPServiceItem) {
        this.selectedSopService = service;
    }

    getAvailableNextServices(): SOPServiceItem[] {
        if (!this.sopData?.services || !this.targetServiceForSubtask) {
            return [];
        }
        return this.sopData.services.filter(
            (s: SOPServiceItem) => s.id !== this.targetServiceForSubtask?.id && s.service_status !== 'removed'
        );
    }

    openAddSubtask(service?: SOPServiceItem, event?: Event) {
        if (event) event.stopPropagation();
        this.targetServiceForSubtask = service || this.selectedSopService;
        if (!this.targetServiceForSubtask) return;

        this.newSubtask = {
            title: '',
            description: '',
            start_date: this.targetServiceForSubtask.start_date ? this.formatDateForInput(this.targetServiceForSubtask.start_date) : '',
            end_date: this.targetServiceForSubtask.end_date ? this.formatDateForInput(this.targetServiceForSubtask.end_date) : '',
            next_order_service_id: null
        };
        this.showAddSubtaskModal = true;
    }

    closeAddSubtaskModal() {
        this.showAddSubtaskModal = false;
        this.targetServiceForSubtask = null;
        this.newSubtask = { title: '', description: '', start_date: '', end_date: '', next_order_service_id: null };
    }

    async saveSubtask() {
        if (!this.newSubtask.title.trim()) {
            this.showToast('Please enter a subtask title.', 'warning');
            return;
        }

        if (!this.targetServiceForSubtask) return;

        this.isSavingSubtask = true;
        this.sopService.createSubtask(this.targetServiceForSubtask.id, {
            title: this.newSubtask.title.trim(),
            description: this.newSubtask.description.trim() || undefined,
            start_date: this.newSubtask.start_date || undefined,
            end_date: this.newSubtask.end_date || undefined,
            next_order_service_id: this.newSubtask.next_order_service_id || null
        }).subscribe({
            next: (created) => {
                this.isSavingSubtask = false;
                this.closeAddSubtaskModal();
                this.showToast(`✅ Subtask "${created.title}" added successfully.`, 'success');
                this.loadOrderSOP(this.selectedSopOrderId);
            },
            error: (err) => {
                this.isSavingSubtask = false;
                this.showToast(err?.error?.message || 'Could not add subtask.', 'danger');
            }
        });
    }

    selectedProofImageUrl: string | null = null;

    openSubtaskDetails(subtask: SOPSubtask, service?: SOPServiceItem, event?: Event) {
        if (event) event.stopPropagation();
        this.selectedSubtask = subtask;
        this.selectedSubtaskService = service || this.selectedSopService;
        this.selectedProofImageUrl = this.getDefaultSubtaskProofUrl(subtask);
        this.showSubtaskDetailsModal = true;
    }

    closeSubtaskDetailsModal() {
        this.showSubtaskDetailsModal = false;
        this.selectedSubtask = null;
        this.selectedSubtaskService = null;
        this.selectedProofImageUrl = null;
    }

    selectSubtaskProofImage(imageUrl: string, event?: Event) {
        if (event) event.stopPropagation();
        this.selectedProofImageUrl = imageUrl;
    }

    getDefaultSubtaskProofUrl(st?: SOPSubtask | null): string {
        const target = st || this.selectedSubtask;
        if (!target) return '';
        if (target.proof_images && target.proof_images.length > 0) {
            return target.proof_images[0].image_url;
        }
        if (target.proof_image_url) return target.proof_image_url;
        return '';
    }

    getActiveSubtaskProofUrl(): string {
        if (this.selectedProofImageUrl) {
            return this.selectedProofImageUrl;
        }
        return this.getDefaultSubtaskProofUrl();
    }

    async completeSubtask(subtask: SOPSubtask) {
        const loading = await this.loadingCtrl.create({
            message: 'Marking subtask completed...',
            spinner: 'crescent'
        });
        await loading.present();

        this.sopService.completeSubtask(subtask.id).subscribe({
            next: async (res) => {
                await loading.dismiss();
                subtask.status = 'completed';
                if (this.selectedSubtask && this.selectedSubtask.id === subtask.id) {
                    this.selectedSubtask = res;
                }
                this.showToast(`✅ Subtask "${subtask.title}" marked as Completed!`, 'success');
                this.loadOrderSOP(this.selectedSopOrderId);
            },
            error: async (err) => {
                await loading.dismiss();
                this.showToast(err?.error?.message || 'Could not complete subtask.', 'danger');
            }
        });
    }

    onProofFileSelected(event: any, subtask: SOPSubtask) {
        const file = event.target?.files?.[0];
        if (!file) return;

        this.isUploadingProof = true;
        this.sopService.uploadProof(subtask.id, file, false).subscribe({
            next: (res) => {
                this.isUploadingProof = false;
                this.showToast('✅ Completion proof uploaded successfully.', 'success');
                const st = res?.subtask || res?.data?.subtask;
                if (st) {
                    this.selectedSubtask = st;
                } else if (res?.file_url || res?.proof_image_url) {
                    const u = res?.proof_image_url || res?.file_url;
                    if (this.selectedSubtask) {
                        this.selectedSubtask.proof_image_url = u;
                        if (!this.selectedSubtask.proof_images) this.selectedSubtask.proof_images = [];
                        this.selectedSubtask.proof_images.push({
                            id: Date.now(),
                            subtask_id: subtask.id,
                            image_url: u,
                            original_name: file.name
                        });
                    }
                }
                this.loadOrderSOP(this.selectedSopOrderId);
            },
            error: (err) => {
                this.isUploadingProof = false;
                this.showToast(err?.error?.message || 'Proof image upload failed.', 'danger');
            }
        });
    }

    openRaiseCompletionModal(service: SOPServiceItem, event?: Event) {
        if (event) event.stopPropagation();
        this.targetServiceForCompletion = service;
        this.completionNote = `All sub tasks and phase work completed for ${service.service_name || service.subcategory_name}. Ready for customer review.`;
        this.showRaiseCompletionModal = true;
    }

    closeRaiseCompletionModal() {
        this.showRaiseCompletionModal = false;
        this.targetServiceForCompletion = null;
        this.completionNote = '';
    }

    async submitRaiseCompletion() {
        if (!this.targetServiceForCompletion) return;
        this.isRaisingCompletion = true;

        this.sopService.raiseCompletionRequest(this.targetServiceForCompletion.id, this.completionNote).subscribe({
            next: (req) => {
                this.isRaisingCompletion = false;
                this.closeRaiseCompletionModal();
                this.showToast('🎉 Completion request submitted to customer!', 'success');
                this.loadOrderSOP(this.selectedSopOrderId);
            },
            error: (err) => {
                this.isRaisingCompletion = false;
                this.showToast(err?.error?.message || 'Failed to submit completion request.', 'danger');
            }
        });
    }

    formatDateForInput(dateStr: string): string {
        if (!dateStr) return '';
        const d = new Date(dateStr);
        if (isNaN(d.getTime())) return '';
        return d.toISOString().split('T')[0];
    }

    getProgressColor(status: string, percent: number): string {
        if (status === 'completed' || percent === 100) return '#10b981';
        if (status === 'in_progress' || percent > 0) return '#f59e0b';
        return '#cbd5e1';
    }

    getSubtaskDotClass(status: string): string {
        if (status === 'completed') return 'dot-completed';
        if (status === 'in_progress') return 'dot-in-progress';
        return 'dot-pending';
    }

    getSubtaskBadgeClass(status: string): string {
        if (status === 'completed') return 'badge-completed';
        if (status === 'in_progress') return 'badge-in-progress';
        return 'badge-pending';
    }

    getStatusText(status: string): string {
        if (status === 'completed') return 'Completed';
        if (status === 'in_progress') return 'In Progress';
        return 'Pending';
    }

    openSopFromChat(orderId: any) {
        this.showChatPanel = false;
        this.activeTab = 'sop';
        if (orderId) {
            this.selectedSopOrderId = orderId;
            this.loadOrderSOP(orderId);
        } else if (this.sopOrders.length > 0) {
            const first = this.sopOrders[0];
            this.selectedSopOrderId = first.order_no || first.id;
            this.loadOrderSOP(this.selectedSopOrderId);
        } else {
            this.loadSopOrders();
        }
    }
}
