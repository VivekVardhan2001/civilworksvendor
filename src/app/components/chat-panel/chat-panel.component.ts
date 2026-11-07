import { Component, Input, Output, EventEmitter, OnInit, OnDestroy, OnChanges, SimpleChanges, ViewChild, ElementRef, ChangeDetectorRef } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { IonicModule, ToastController, AlertController } from '@ionic/angular';
import { Subscription } from 'rxjs';
import { ChatService, Conversation, ChatMessage } from '../../services/chat.service';
import { AuthService } from '../../services/auth.service';
import { SOPService, OrderSOPData, SOPServiceItem, SOPSubtask, SubtaskProofImage, SOPComment } from '../../services/sop.service';
import { environment } from '../../../environments/environment';

@Component({
    selector: 'app-chat-panel',
    templateUrl: './chat-panel.component.html',
    styleUrls: ['./chat-panel.component.scss'],
    standalone: true,
    imports: [CommonModule, FormsModule, IonicModule]
})
export class ChatPanelComponent implements OnInit, OnDestroy, OnChanges {
    @Input() isOpen = false;
    @Input() initialOrderId?: number | string | null;
    @Input() initialViewTab: 'chat' | 'sop' = 'chat';
    @Output() close = new EventEmitter<void>();
    @Output() editOrderRequested = new EventEmitter<any>();
    @Output() openSop = new EventEmitter<string | number | null | undefined>();

    @ViewChild('messagesContainer') private messagesContainer!: ElementRef;
    @ViewChild('fileInputImage') private fileInputImage!: ElementRef<HTMLInputElement>;
    @ViewChild('fileInputVideo') private fileInputVideo!: ElementRef<HTMLInputElement>;
    @ViewChild('fileInputAudio') private fileInputAudio!: ElementRef<HTMLInputElement>;
    @ViewChild('fileInputDoc') private fileInputDoc!: ElementRef<HTMLInputElement>;

    conversations: Conversation[] = [];
    filteredConversations: Conversation[] = [];
    activeConversation: Conversation | null = null;
    messages: ChatMessage[] = [];
    searchQuery: string = '';
    messageText: string = '';
    isUploading: boolean = false;
    showAttachMenu: boolean = false;
    currentUser: any = null;
    isSubmittingAction = false;

    // View tab: 'chat' or 'sop'
    activeViewTab: 'chat' | 'sop' = 'chat';

    // About Group Details Dropdown
    showAboutDropdown = false;

    // SOP Sequence Embedded State
    loadingSop = false;
    private isFetchingSop = false;
    sopData: OrderSOPData | null = null;
    selectedSopService: SOPServiceItem | null = null;
    draggedServiceIndex: number | null = null;

    // Subtask Modals State
    showAddSubtaskModal = false;
    targetServiceForSubtask: SOPServiceItem | null = null;
    newSubtask: { title: string; description: string; start_date: string; end_date: string; next_order_service_id: number | null } = { title: '', description: '', start_date: '', end_date: '', next_order_service_id: null };
    isSavingSubtask = false;

    showSubtaskDetailsModal = false;
    selectedSubtask: SOPSubtask | null = null;
    selectedSubtaskService: SOPServiceItem | null = null;
    isUploadingProof = false;
    proofNote = '';

    // Subtask Done Confirmation & Image Proof Modal State
    showCompleteSubtaskModal = false;
    subtaskToComplete: SOPSubtask | null = null;
    serviceForSubtaskToComplete: SOPServiceItem | null = null;
    completionDescription: string = '';
    completionImageFile: File | null = null;
    completionImagePreview: string | null = null;
    isCompletingSubtask = false;

    // Site Workflow: edit, comments and approval state
    editingSubtask: SOPSubtask | null = null;
    showCommentsModal = false;
    commentsTarget: { kind: 'subtask' | 'service'; id: number; title: string } | null = null;
    newComment = '';
    isPostingComment = false;
    showEditServiceModal = false;
    editServiceTarget: SOPServiceItem | null = null;
    editServiceForm = { start_date: '', end_date: '', description: '' };
    isSavingService = false;

    // Voice Recording State
    isRecordingVoice = false;
    recordingSeconds = 0;
    private mediaRecorder: any = null;
    private audioChunks: Blob[] = [];
    private recordingTimer: any = null;
    private audioStream: MediaStream | null = null;

    // Lightbox / Image Preview Modal
    previewImageUrl: string | null = null;

    private subs: Subscription = new Subscription();

    constructor(
        public chatService: ChatService,
        private authService: AuthService,
        private sopService: SOPService,
        private toastCtrl: ToastController,
        private alertCtrl: AlertController,
        private cdr: ChangeDetectorRef
    ) { }

    ngOnInit() {
        this.currentUser = this.authService.getUser();
        if (!this.currentUser) {
            const raw = localStorage.getItem('civilworks_vendor_user') || localStorage.getItem('civilworks_user');
            if (raw) {
                try { this.currentUser = JSON.parse(raw); } catch (e) { }
            }
        }

        if (this.initialViewTab) {
            this.activeViewTab = this.initialViewTab;
        }

        this.subs.add(
            this.chatService.conversations$.subscribe(convs => {
                this.conversations = convs;
                this.applySearch();

                // 1. If we have a target initialOrderId and either no activeConversation or activeConversation doesn't match
                if (this.initialOrderId) {
                    const target = this.initialOrderId;
                    const isTargetActive = this.activeConversation && (
                        this.activeConversation.order_id == target ||
                        this.activeConversation.order_no == target ||
                        String(this.activeConversation.order_no).toLowerCase() === String(target).toLowerCase()
                    );
                    if (!isTargetActive) {
                        const found = convs.find(c =>
                            c.order_id == target ||
                            c.order_no == target ||
                            String(c.order_no).toLowerCase() === String(target).toLowerCase()
                        );
                        if (found) {
                            this.selectConversation(found);
                            return;
                        }
                    }
                }

                // 2. Validate current activeConversation in the updated conversations list
                if (this.activeConversation) {
                    const matchedActive = convs.find(c => c.id === this.activeConversation!.id || c.order_id === this.activeConversation!.order_id);
                    if (matchedActive) {
                        this.activeConversation = matchedActive;
                    } else if (convs.length > 0) {
                        this.selectConversation(convs[0]);
                    } else {
                        this.activeConversation = null;
                        this.sopData = null;
                        this.selectedSopService = null;
                        this.selectedSubtask = null;
                    }
                } else if (convs.length > 0) {
                    this.selectConversation(convs[0]);
                } else {
                    this.activeConversation = null;
                    this.sopData = null;
                    this.selectedSopService = null;
                    this.selectedSubtask = null;
                }
                this.cdr.markForCheck();
                try { this.cdr.detectChanges(); } catch (e) { }
            })
        );

        this.subs.add(
            this.chatService.activeConversation$.subscribe(conv => {
                if (conv && this.activeConversation && conv.id === this.activeConversation.id) {
                    this.activeConversation = conv;
                }
                this.cdr.markForCheck();
                try { this.cdr.detectChanges(); } catch (e) { }
            })
        );

        this.subs.add(
            this.chatService.messages$.subscribe(msgs => {
                this.messages = msgs;
                this.cdr.markForCheck();
                try { this.cdr.detectChanges(); } catch (e) { }
                this.scrollToBottom();
            })
        );

        // Real-time SOP sequence updates (subtasks, proofs, completions)
        this.subs.add(
            this.chatService.sopUpdated$.subscribe(({ event, data }) => {
                const currentOrderId = this.sopData?.id || this.activeConversation?.order_id;
                const currentOrderNo = this.sopData?.order_no || this.activeConversation?.order_no;
                const eventOrderId = data?.orderId || data?.order_id;
                const eventOrderNo = data?.order_no;

                const hasEventId = !!(eventOrderId || eventOrderNo);
                const isMatch = hasEventId && (
                    (eventOrderId && currentOrderId && Number(eventOrderId) === Number(currentOrderId)) ||
                    (eventOrderNo && currentOrderNo && String(eventOrderNo).toLowerCase() === String(currentOrderNo).toLowerCase())
                );

                if (isMatch) {
                    if (event === 'sop_sequence_updated' && data?.services && this.sopData) {
                        this.sopData.services = data.services;
                    } else if (this.activeViewTab === 'sop' || this.sopData) {
                        this.loadSopForActiveConversation(false);
                    }
                }
                this.cdr.markForCheck();
                try { this.cdr.detectChanges(); } catch (e) { }
            })
        );

        // Real-time Order and Service status events
        this.subs.add(
            this.chatService.orderEvent$.subscribe(({ event, data }) => {
                const currentOrderId = this.activeConversation?.order_id;
                const currentOrderNo = this.activeConversation?.order_no;
                const eventOrderId = data?.orderId || data?.order_id;
                const eventOrderNo = data?.order_no;

                const hasEventId = !!(eventOrderId || eventOrderNo);
                const isMatch = hasEventId && (
                    (eventOrderId && currentOrderId && Number(eventOrderId) === Number(currentOrderId)) ||
                    (eventOrderNo && currentOrderNo && String(eventOrderNo).toLowerCase() === String(currentOrderNo).toLowerCase())
                );

                if (isMatch) {
                    if (this.activeConversation && data?.services) {
                        this.activeConversation = { ...this.activeConversation, services: data.services };
                    }
                    if (this.activeViewTab === 'sop' || this.sopData) {
                        this.loadSopForActiveConversation(false);
                    }
                }
                this.cdr.markForCheck();
                try { this.cdr.detectChanges(); } catch (e) { }
            })
        );

        this.chatService.loadConversations().subscribe({ error: () => { } });
    }

    ngOnChanges(changes: SimpleChanges) {
        if (changes['initialViewTab'] && changes['initialViewTab'].currentValue) {
            const newTab = changes['initialViewTab'].currentValue;
            if (this.activeViewTab !== newTab) {
                this.activeViewTab = newTab;
                if (this.activeViewTab === 'sop') {
                    const hasData = !!(this.sopData && this.sopData.services && this.sopData.services.length > 0);
                    this.loadSopForActiveConversation(!hasData);
                }
            }
        }

        if (changes['initialOrderId']) {
            const target = changes['initialOrderId'].currentValue;
            if (target) {
                const found = this.conversations.find(c =>
                    c.order_id == target ||
                    c.order_no == target ||
                    String(c.order_no).toLowerCase() === String(target).toLowerCase()
                );
                if (found) {
                    this.selectConversation(found);
                }
            }
        }

        if (changes['isOpen']) {
            if (changes['isOpen'].currentValue) {
                this.closeAboutDropdown();
                this.activeViewTab = this.initialViewTab || 'chat';
                this.chatService.ensureSocketConnected();

                // If opening for a specific target order, select it immediately
                if (this.initialOrderId) {
                    const target = this.initialOrderId;
                    const found = this.conversations.find(c =>
                        c.order_id == target ||
                        c.order_no == target ||
                        String(c.order_no).toLowerCase() === String(target).toLowerCase()
                    );
                    if (found) {
                        this.selectConversation(found);
                    }
                }

                // Refresh conversations from API whenever drawer is opened
                this.chatService.loadConversations().subscribe({
                    next: (res: any) => {
                        const convs = res?.data || this.conversations;
                        if (this.initialOrderId) {
                            const target = this.initialOrderId;
                            const found = convs.find((c: any) =>
                                c.order_id == target ||
                                c.order_no == target ||
                                String(c.order_no).toLowerCase() === String(target).toLowerCase()
                            );
                            if (found) {
                                this.selectConversation(found);
                                return;
                            }
                        }
                        if (convs.length > 0 && !this.activeConversation) {
                            this.selectConversation(convs[0]);
                        }
                    }
                });

                if (this.activeConversation) {
                    this.chatService.joinConversationRoom(this.activeConversation.id);
                    if (this.activeConversation.order_id) {
                        this.chatService.joinOrderRoom(this.activeConversation.order_id);
                    }
                }
                if (this.activeViewTab === 'sop') {
                    const hasData = !!(this.sopData && this.sopData.services && this.sopData.services.length > 0);
                    this.loadSopForActiveConversation(!hasData);
                }
            } else {
                // Drawer closed: reset active conversation & SOP so next open starts fresh
                this.closeAboutDropdown();
                this.cancelVoiceRecording();
                this.activeConversation = null;
                this.sopData = null;
                this.selectedSopService = null;
                this.selectedSubtask = null;
            }
            this.cdr.markForCheck();
            try { this.cdr.detectChanges(); } catch (e) { }
        }
    }

    ngOnDestroy() {
        this.cancelVoiceRecording();
        this.subs.unsubscribe();
    }

    // ── Tab & Dropdown Navigation ──

    setViewTab(tab: 'chat' | 'sop') {
        if (this.activeViewTab === tab) return;
        this.activeViewTab = tab;
        this.closeAboutDropdown();
        if (tab === 'sop') {
            const hasData = !!(this.sopData && this.sopData.services && this.sopData.services.length > 0);
            this.loadSopForActiveConversation(!hasData);
        }
    }

    toggleAboutDropdown() {
        this.showAboutDropdown = !this.showAboutDropdown;
    }

    closeAboutDropdown() {
        this.showAboutDropdown = false;
    }

    applySearch() {
        if (!this.searchQuery.trim()) {
            this.filteredConversations = this.conversations;
        } else {
            const q = this.searchQuery.toLowerCase();
            this.filteredConversations = this.conversations.filter(c =>
                (c.title || '').toLowerCase().includes(q) ||
                (c.order_no || '').toLowerCase().includes(q) ||
                (c.services || []).some((s: any) => (s.subcategory_name || '').toLowerCase().includes(q))
            );
        }
    }

    get ongoingConversations(): Conversation[] {
        return this.filteredConversations.filter(c =>
            c.order_status !== 'delivered' && c.order_status !== 'cancelled'
        );
    }

    get completedConversations(): Conversation[] {
        return this.filteredConversations.filter(c =>
            c.order_status === 'delivered' || c.order_status === 'cancelled'
        );
    }

    isMyMessage(m: ChatMessage): boolean {
        if (!m || m.message_type === 'system' || m.sender_type === 'system') return false;
        const myVendorId = this.currentUser?.vendor_id || (this.currentUser?.role === 'vendor' ? this.currentUser?.id : null);
        if (myVendorId) {
            return m.sender_type === 'vendor' && m.sender_id == myVendorId;
        }
        return m.sender_type === 'customer' || m.sender_id == this.currentUser?.id;
    }

    selectConversation(conv: Conversation) {
        this.cancelVoiceRecording();

        const isSameConv = this.activeConversation && this.activeConversation.id === conv.id;
        const isSameOrder = this.activeConversation && conv.order_id && (this.activeConversation.order_id === conv.order_id);

        // Keep initialOrderId in sync with user selection so nothing overwrites it
        this.initialOrderId = conv.order_no || conv.order_id;

        if (isSameConv) {
            // Already active. If on SOP tab, ensure data is loaded silently without resetting or flashing
            if (this.activeViewTab === 'sop') {
                const hasData = !!(this.sopData && this.sopData.services && this.sopData.services.length > 0);
                this.loadSopForActiveConversation(!hasData);
            }
            this.cdr.markForCheck();
            try { this.cdr.detectChanges(); } catch (e) { }
            return;
        }

        if (this.activeConversation?.order_id && this.activeConversation.order_id !== conv.order_id) {
            this.chatService.leaveOrderRoom(this.activeConversation.order_id);
        }
        // Reset SOP and selected state when switching conversation to a different order
        if (!isSameOrder) {
            this.sopData = null;
            this.selectedSopService = null;
            this.selectedSubtask = null;
        }

        this.activeConversation = conv;
        this.chatService.setActiveConversation(conv);
        if (conv.order_id) {
            this.chatService.joinOrderRoom(conv.order_id);
        }
        this.closeAboutDropdown();
        const hasSopData = !isSameOrder ? false : !!(this.sopData && this.sopData.services && this.sopData.services.length > 0);
        this.loadSopForActiveConversation(this.activeViewTab === 'sop' && !hasSopData);
        this.cdr.markForCheck();
        try { this.cdr.detectChanges(); } catch (e) { }
    }

    // ── Complete Entire Order & Messaging Restrictions ──

    get isOrderClosed(): boolean {
        if (!this.activeConversation) return false;
        const c = this.activeConversation;
        if (c.order_status === 'delivered' || c.order_status === 'completed' || c.conversation_status === 'closed') {
            return true;
        }
        const svcs = (c.services || []).filter((s: any) => s.service_status !== 'removed');
        if (svcs.length > 0 && svcs.every((s: any) => s.service_status === 'completed')) {
            return true;
        }
        return false;
    }

    // ── Messaging Methods ──

    sendTextMessage() {
        if (!this.messageText.trim() || !this.activeConversation || this.isOrderClosed || this.isMyWorkCompleted) return;

        const text = this.messageText.trim();
        this.messageText = '';

        this.chatService.sendMessage(this.activeConversation.id, {
            content: text,
            message_type: 'text'
        }).subscribe({
            next: () => this.scrollToBottom(),
            error: (err) => {
                const msg = err.error?.message || 'Failed to send message';
                this.showToast(msg, 'danger');
            }
        });
    }

    openAttachmentMenu() {
        if (this.isOrderClosed || this.isMyWorkCompleted) return;
        this.showAttachMenu = !this.showAttachMenu;
    }

    triggerUpload(type: 'image' | 'video' | 'audio' | 'doc') {
        if (this.isOrderClosed || this.isMyWorkCompleted) return;
        this.showAttachMenu = false;
        if (type === 'image') this.fileInputImage.nativeElement.click();
        if (type === 'video') this.fileInputVideo.nativeElement.click();
        if (type === 'audio') this.fileInputAudio.nativeElement.click();
        if (type === 'doc') this.fileInputDoc.nativeElement.click();
    }

    onFileSelected(event: any, type: string) {
        if (this.isOrderClosed || this.isMyWorkCompleted) return;
        const file = event.target.files?.[0];
        if (!file || !this.activeConversation) return;

        this.isUploading = true;
        this.chatService.uploadAttachment(file).subscribe({
            next: (res) => {
                const uploadData = res.data;
                const fileUrl = uploadData.url || uploadData.file_url || uploadData.attachment_url;
                const fileName = uploadData.filename || uploadData.file_name || uploadData.attachment_name;
                const fileSize = uploadData.size || uploadData.file_size || uploadData.attachment_size;
                const fileType = uploadData.mimetype || uploadData.file_type || uploadData.attachment_mime;
                const msgType = uploadData.message_type || type;

                this.chatService.sendMessage(this.activeConversation!.id, {
                    content: fileName,
                    message_type: msgType,
                    attachment_url: fileUrl,
                    attachment_name: fileName,
                    attachment_size: fileSize,
                    attachment_mime: fileType,
                    file_url: fileUrl,
                    file_name: fileName,
                    file_size: fileSize,
                    file_type: fileType
                }).subscribe({
                    next: () => {
                        this.isUploading = false;
                        this.scrollToBottom();
                    },
                    error: () => this.isUploading = false
                });
            },
            error: (err) => {
                this.isUploading = false;
                const msg = err.error?.message || 'Attachment upload failed';
                this.showToast(msg, 'danger');
            }
        });

        event.target.value = '';
    }

    // ── Voice Recording Workflow ──

    async startVoiceRecording() {
        if (this.isOrderClosed || this.isMyWorkCompleted) return;
        if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) {
            this.showToast('Audio recording is not supported in this browser.', 'warning');
            return;
        }

        try {
            this.audioStream = await navigator.mediaDevices.getUserMedia({ audio: true });

            let mimeType = 'audio/webm';
            if (typeof MediaRecorder !== 'undefined') {
                if (MediaRecorder.isTypeSupported('audio/webm')) mimeType = 'audio/webm';
                else if (MediaRecorder.isTypeSupported('audio/mp4')) mimeType = 'audio/mp4';
                else if (MediaRecorder.isTypeSupported('audio/ogg')) mimeType = 'audio/ogg';
                else mimeType = '';
            }

            const options = mimeType ? { mimeType } : undefined;
            this.mediaRecorder = new MediaRecorder(this.audioStream, options);
            this.audioChunks = [];

            this.mediaRecorder.ondataavailable = (event: any) => {
                if (event.data && event.data.size > 0) {
                    this.audioChunks.push(event.data);
                }
            };

            this.mediaRecorder.start(200);
            this.isRecordingVoice = true;
            this.recordingSeconds = 0;

            this.recordingTimer = setInterval(() => {
                this.recordingSeconds++;
            }, 1000);
        } catch (e: any) {
            console.error('Microphone access failed:', e);
            this.showToast('Microphone access denied or unavailable.', 'danger');
            this.cleanupAudioStream();
        }
    }

    stopVoiceRecordingAndSend() {
        if (!this.mediaRecorder || !this.isRecordingVoice) return;

        this.mediaRecorder.onstop = () => {
            const audioBlob = new Blob(this.audioChunks, { type: this.mediaRecorder.mimeType || 'audio/webm' });
            this.cleanupAudioStream();
            this.uploadAndSendAudioBlob(audioBlob);
        };

        try {
            this.mediaRecorder.stop();
        } catch (e) {
            this.cleanupAudioStream();
        }
        this.isRecordingVoice = false;
        clearInterval(this.recordingTimer);
    }

    cancelVoiceRecording() {
        if (this.mediaRecorder && this.isRecordingVoice) {
            try { this.mediaRecorder.stop(); } catch (e) { }
        }
        this.isRecordingVoice = false;
        clearInterval(this.recordingTimer);
        this.audioChunks = [];
        this.cleanupAudioStream();
    }

    private cleanupAudioStream() {
        if (this.audioStream) {
            this.audioStream.getTracks().forEach(t => t.stop());
            this.audioStream = null;
        }
    }

    private uploadAndSendAudioBlob(blob: Blob) {
        if (!this.activeConversation || blob.size === 0) return;

        const ext = (this.mediaRecorder?.mimeType || '').includes('mp4') ? 'mp4' : 'webm';
        const fileName = `voice_note_${Date.now()}.${ext}`;
        const file = new File([blob], fileName, { type: blob.type || 'audio/webm' });

        this.isUploading = true;
        this.chatService.uploadAttachment(file).subscribe({
            next: (res) => {
                const uploadData = res.data;
                const fileUrl = uploadData.url || uploadData.file_url || uploadData.attachment_url;

                this.chatService.sendMessage(this.activeConversation!.id, {
                    content: 'Voice note',
                    message_type: 'audio',
                    attachment_url: fileUrl,
                    attachment_name: fileName,
                    attachment_size: blob.size,
                    attachment_mime: blob.type,
                    file_url: fileUrl,
                    file_name: fileName,
                    file_size: blob.size,
                    file_type: blob.type
                }).subscribe({
                    next: () => {
                        this.isUploading = false;
                        this.scrollToBottom();
                    },
                    error: () => this.isUploading = false
                });
            },
            error: (err) => {
                this.isUploading = false;
                const msg = err.error?.message || 'Failed to upload voice note';
                this.showToast(msg, 'danger');
            }
        });
    }

    get recordingDurationFormatted(): string {
        const mins = Math.floor(this.recordingSeconds / 60);
        const secs = this.recordingSeconds % 60;
        return `${mins < 10 ? '0' : ''}${mins}:${secs < 10 ? '0' : ''}${secs}`;
    }

    // ── Role & Completion Helpers ──

    get isCustomerUser(): boolean {
        return false;
    }

    get clientDisplayName(): string {
        return 'Client: ' + ((this.activeConversation as any)?.customer_name || 'Customer');
    }

    get currentVendorId(): number | null {
        if (this.currentUser?.vendor_id) return Number(this.currentUser.vendor_id);
        if (this.currentUser?.role === 'vendor') return Number(this.currentUser.id);
        if (this.currentUser?.id) return Number(this.currentUser.id);
        return null;
    }

    get myActiveService(): any {
        const vid = this.currentVendorId;
        if (!this.activeConversation?.services || this.activeConversation.services.length === 0) return null;
        if (vid) {
            const match = this.activeConversation.services.find((s: any) => s.vendor_id == vid && s.service_status !== 'removed');
            if (match) return match;
        }
        return this.activeConversation.services[0];
    }

    get isMyWorkCompleted(): boolean {
        if (!this.activeConversation?.services || this.activeConversation.services.length === 0) return false;
        const vid = this.currentVendorId;
        const myServices = this.activeConversation.services.filter(
            (s: any) => (!vid || s.vendor_id == vid) && s.service_status !== 'removed'
        );
        return myServices.length > 0 && myServices.every((s: any) => s.service_status === 'completed');
    }

    get canRequestCompletion(): boolean {
        if (this.isOrderClosed) return false;
        if (this.isMyWorkCompleted) return false;
        if (!this.activeConversation) return false;
        const vid = this.currentVendorId;
        const services = this.activeConversation.services || [];
        if (services.length === 0) return true;
        const pending = this.pendingApprovalServiceIds;
        const myServices = services.filter(
            (s: any) => (!vid || s.vendor_id == vid) && s.vendor_status === 'accepted' && s.service_status !== 'removed' && s.service_status !== 'completed' && !pending.includes(Number(s.id))
        );
        return myServices.length > 0;
    }

    get ongoingServices(): any[] {
        if (!this.activeConversation?.services) return [];
        return this.activeConversation.services.filter((s: any) => s.service_status !== 'completed' && s.service_status !== 'removed');
    }

    get hasOngoingServices(): boolean {
        return this.ongoingServices.length > 0;
    }

    get allServicesCompleted(): boolean {
        const services = (this.activeConversation?.services || []).filter((s: any) => s.service_status !== 'removed');
        return services.length > 0 && services.every((s: any) => s.service_status === 'completed');
    }

    isServiceCompleted(service: any): boolean {
        if (!service) return false;
        return service.service_status === 'completed';
    }

    // ── Completion Request Cards & Actions ──

    isCompletionRequestMessage(m: any): boolean {
        if (!m) return false;
        if (m.file_type === 'completion_request' || m.message_type === 'completion_request') return true;
        if (m.metadata && (m.metadata.action === 'completion_request' || m.metadata.type === 'completion_request')) return true;
        const content = (m.content || '').toLowerCase();
        return content.includes('acceptance request') || content.includes('completion request') || content.includes('submitted work completion');
    }

    isWorkCompletedMessage(m: any): boolean {
        if (!m) return false;
        if (m.metadata && (m.metadata.action === 'work_completed' || m.metadata.action === 'order_completed')) return true;
        const content = (m.content || '').toLowerCase();
        return content.includes('marked') && content.includes('completed');
    }

    getCompletionMetadata(m: any): any {
        if (!m) return {};
        if (m.metadata) {
            if (typeof m.metadata === 'string') {
                try { return JSON.parse(m.metadata); } catch (e) { }
            } else {
                return m.metadata;
            }
        }
        return {};
    }

    getServiceNameFromMessage(m: any): string {
        const meta = this.getCompletionMetadata(m);
        if (meta.service_name) return meta.service_name;
        if (meta.subcategory_name) return meta.subcategory_name;
        if (this.activeConversation?.services) {
            const found = this.activeConversation.services.find((s: any) =>
                (meta.service_id && s.id == meta.service_id) ||
                (meta.vendor_id && s.vendor_id == meta.vendor_id && s.service_status !== 'removed')
            );
            if (found) return found.subcategory_name || found.service_name;
        }
        return 'Service';
    }

    getCompletionReqVendorName(m: any): string {
        const meta = this.getCompletionMetadata(m);
        return meta.vendor_name || m.sender_name || 'Assigned Vendor';
    }

    getCompletionReqServiceName(m: any): string {
        return this.getServiceNameFromMessage(m);
    }

    isServiceMarkedCompleted(m: any): boolean {
        const meta = this.getCompletionMetadata(m);
        const sId = meta.service_id;
        const vId = meta.vendor_id;
        if (!this.activeConversation?.services) return false;
        const s = this.activeConversation.services.find((item: any) =>
            (sId && item.id == sId) ||
            (vId && item.vendor_id == vId && item.service_status !== 'removed')
        );
        return s ? s.service_status === 'completed' : false;
    }

    async promptRequestCompletion() {
        const service = this.serviceToSubmit;
        const serviceName = service?.subcategory_name || service?.service_name || 'your assigned trade';

        const alert = await this.alertCtrl.create({
            header: 'Submit for Approval',
            message: `Send your work on "${serviceName}" to the customer for approval? It will show as Approval Pending until the customer approves it or asks for changes.`,
            buttons: [
                { text: 'Cancel', role: 'cancel' },
                {
                    text: 'Submit for Approval',
                    handler: () => {
                        this.chatService.requestCompletion(this.activeConversation!.id, service?.id).subscribe({
                            next: (res: any) => {
                                if (res && !res.data) {
                                    this.showToast(res.message || 'Already waiting for the customer\'s approval.', 'warning');
                                } else {
                                    this.showToast('Status updated to Approval Pending. The customer needs to approve your work, please wait for their response.', 'success');
                                }
                                this.loadSopForActiveConversation(false);
                                this.scrollToBottom();
                            },
                            error: (err) => {
                                const msg = err.error?.message || 'Failed to send completion request';
                                this.showToast(msg, 'danger');
                            }
                        });
                    }
                }
            ]
        });
        await alert.present();
    }

    // ── SOP Sequence Module Embedded Methods ──

    loadSopForActiveConversation(showSkeleton: boolean = true) {
        const orderIdentifier = this.activeConversation?.order_no || this.activeConversation?.order_id || this.initialOrderId;
        if (!orderIdentifier) {
            this.sopData = null;
            this.selectedSopService = null;
            this.selectedSubtask = null;
            this.loadingSop = false;
            return;
        }

        if (this.isFetchingSop) {
            return;
        }

        const hasMatchingData = !!(this.sopData && this.sopData.services && this.sopData.services.length > 0 && (
            this.sopData.order_no == orderIdentifier ||
            this.sopData.id == orderIdentifier ||
            (this.activeConversation?.order_id && this.sopData.id == this.activeConversation.order_id) ||
            (this.activeConversation?.order_no && this.sopData.order_no == this.activeConversation.order_no)
        ));

        if (showSkeleton && !hasMatchingData) {
            this.loadingSop = true;
        }

        this.isFetchingSop = true;
        this.sopService.getOrderSOP(orderIdentifier).subscribe({
            next: (data) => {
                try {
                    this.sopData = data;
                    if (this.sopData?.services && this.sopData.services.length > 0) {
                        if (this.selectedSopService) {
                            const found = this.sopData.services.find(s => s && s.id === this.selectedSopService?.id);
                            this.selectedSopService = found || this.sopData.services[0];
                        } else {
                            const inProg = this.sopData.services.find(s => s && (s.service_status === 'in_progress' || s.vendor_status === 'accepted'));
                            this.selectedSopService = inProg || this.sopData.services[0];
                        }
                    } else {
                        this.selectedSopService = null;
                    }

                    if (this.selectedSubtask) {
                        let matchedSt: SOPSubtask | null = null;
                        for (const s of this.sopData?.services || []) {
                            const foundSt = (s?.subtasks || []).find(st => st && st.id === this.selectedSubtask?.id);
                            if (foundSt) {
                                matchedSt = foundSt;
                                break;
                            }
                        }
                        this.selectedSubtask = matchedSt;
                    }
                } catch (e) {
                    console.error('Error processing SOP data in vendor chat:', e);
                } finally {
                    this.isFetchingSop = false;
                    this.loadingSop = false;
                    this.cdr.markForCheck();
                    try { this.cdr.detectChanges(); } catch (e) { }
                }
            },
            error: (err) => {
                console.error('Failed to load SOP details for vendor in chat:', err);
                if (!hasMatchingData) {
                    this.sopData = null;
                    this.selectedSopService = null;
                    this.selectedSubtask = null;
                }
                this.isFetchingSop = false;
                this.loadingSop = false;
                this.cdr.markForCheck();
                try { this.cdr.detectChanges(); } catch (e) { }
            }
        });
    }

    selectSopService(s: SOPServiceItem) {
        this.selectedSopService = s;
    }

    formatDateForInput(d?: string | null): string {
        if (!d) return '';
        try {
            const dt = new Date(d);
            if (isNaN(dt.getTime())) return '';
            const y = dt.getFullYear();
            const m = String(dt.getMonth() + 1).padStart(2, '0');
            const day = String(dt.getDate()).padStart(2, '0');
            return `${y}-${m}-${day}`;
        } catch {
            return '';
        }
    }

    formatDateDisplay(d?: string | null): string {
        if (!d) return 'Not Set';
        try {
            const dt = new Date(d);
            if (isNaN(dt.getTime())) return 'Not Set';
            return dt.toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: 'numeric' });
        } catch {
            return 'Not Set';
        }
    }

    openDatePicker(event: Event) {
        event.stopPropagation();
        const current = event.currentTarget as HTMLElement;
        let input: HTMLInputElement | null = null;
        if (current instanceof HTMLInputElement) {
            input = current;
        } else {
            input = current.querySelector('input[type="date"]');
        }
        if (input) {
            if (typeof (input as any).showPicker === 'function') {
                try {
                    (input as any).showPicker();
                } catch {
                    input.focus();
                }
            } else {
                input.focus();
            }
        }
    }

    validateChronologicalDates(
        services: any[],
        serviceId: number,
        newStartDate: string,
        newEndDate?: string
    ): { valid: boolean; error?: string } {
        // Services can run simultaneously; only validate individual service start_date <= end_date
        if (newStartDate && newEndDate) {
            const newStart = new Date(newStartDate).getTime();
            const newEnd = new Date(newEndDate).getTime();
            if (newStart > newEnd) {
                return { valid: false, error: 'Start date cannot be after End date.' };
            }
        }
        return { valid: true };
    }

    onServiceDateChange(service: SOPServiceItem, field: 'start_date' | 'end_date', event: any) {
        if (!this.sopData) return;
        const newVal = event.target?.value;
        if (!newVal) return;
        const originalStart = service.start_date;
        const originalEnd = service.end_date;

        let proposedStart = field === 'start_date' ? newVal : (service.start_date ? this.formatDateForInput(service.start_date) : '');
        let proposedEnd = field === 'end_date' ? newVal : (service.end_date ? this.formatDateForInput(service.end_date) : '');

        const payload: any = {};
        if (field === 'start_date') {
            payload.start_date = newVal;
            if (proposedEnd && new Date(newVal).getTime() > new Date(proposedEnd).getTime()) {
                payload.end_date = newVal;
                proposedEnd = newVal;
            }
        } else if (field === 'end_date') {
            payload.end_date = newVal;
            if (proposedStart && new Date(newVal).getTime() < new Date(proposedStart).getTime()) {
                payload.start_date = newVal;
                proposedStart = newVal;
            }
        }

        this.sopService.updateService(service.id, payload).subscribe({
            next: () => {
                this.showToast('✅ Service date updated successfully.', 'success');
                if (payload.start_date !== undefined) service.start_date = payload.start_date;
                if (payload.end_date !== undefined) service.end_date = payload.end_date;
                if (this.activeConversation?.services) {
                    const found = this.activeConversation.services.find((cs: any) => cs.id === service.id);
                    if (found) {
                        if (payload.start_date !== undefined) found.start_date = payload.start_date;
                        if (payload.end_date !== undefined) found.end_date = payload.end_date;
                    }
                }
            },
            error: (err) => {
                this.showToast(err.error?.message || 'Failed to update service date.', 'danger');
                event.target.value = field === 'start_date' ? this.formatDateForInput(originalStart) : this.formatDateForInput(originalEnd);
            }
        });
    }

    // Drag and Drop Sequence Reordering
    onServiceDragStart(index: number, event?: DragEvent) {
        if (event) {
            event.stopPropagation();
            if (event.dataTransfer) {
                event.dataTransfer.effectAllowed = 'move';
                event.dataTransfer.setData('text/plain', String(index));
            }
        }
        this.draggedServiceIndex = index;
    }

    onServiceDragOver(event: DragEvent) {
        event.preventDefault();
        event.stopPropagation();
        if (event.dataTransfer) {
            event.dataTransfer.dropEffect = 'move';
        }
    }

    validateReorderSequence(
        services: any[],
        fromIndex: number,
        toIndex: number
    ): { valid: boolean; error?: string } {
        // Free sequence reordering without date restrictions
        return { valid: true };
    }

    onServiceDrop(targetIndex: number, event?: DragEvent) {
        if (event) {
            event.preventDefault();
            event.stopPropagation();
        }
        if (this.draggedServiceIndex === null || this.draggedServiceIndex === targetIndex || !this.sopData) {
            this.draggedServiceIndex = null;
            return;
        }

        const services = [...this.sopData.services];
        const [moved] = services.splice(this.draggedServiceIndex, 1);
        services.splice(targetIndex, 0, moved);

        const updatedSequence = services.map((s, idx) => ({
            id: s.id,
            sequence_order: idx + 1
        }));

        const originalServices = [...this.sopData.services];
        this.sopData.services = services.map((s, idx) => ({ ...s, sequence_order: idx + 1 }));
        this.draggedServiceIndex = null;
        this.cdr.markForCheck();

        const orderTarget = this.sopData.id || this.sopData.order_no || this.activeConversation?.order_id || this.activeConversation?.order_no;
        if (!orderTarget) return;

        this.sopService.reorderServices(orderTarget, updatedSequence).subscribe({
            next: (res: any) => {
                if (res && res.services && Array.isArray(res.services)) {
                    if (this.sopData) {
                        this.sopData.services = res.services;
                    }
                }
                this.showToast('✅ Service sequence updated successfully.', 'success');
                this.cdr.markForCheck();
            },
            error: (err) => {
                if (this.sopData) this.sopData.services = originalServices;
                this.showToast(err.error?.message || 'Could not save new sequence order.', 'danger');
                this.cdr.markForCheck();
            }
        });
    }

    // ── Subtask Drag and Drop Sequence Reordering ──
    draggedSubtaskServiceId: number | null = null;
    draggedSubtaskIndex: number | null = null;

    onSubtaskDragStart(serviceId: number, index: number, event: DragEvent) {
        if (event.dataTransfer) {
            event.dataTransfer.effectAllowed = 'move';
            event.dataTransfer.setData('text/plain', `${serviceId}:${index}`);
        }
        this.draggedSubtaskServiceId = serviceId;
        this.draggedSubtaskIndex = index;
    }

    onSubtaskDragOver(event: DragEvent) {
        event.preventDefault();
        if (event.dataTransfer) {
            event.dataTransfer.dropEffect = 'move';
        }
    }

    onSubtaskDrop(service: SOPServiceItem, targetIndex: number, event: DragEvent) {
        event.preventDefault();
        event.stopPropagation();
        if (this.draggedSubtaskIndex === null || this.draggedSubtaskServiceId !== service.id || this.draggedSubtaskIndex === targetIndex) {
            this.draggedSubtaskIndex = null;
            this.draggedSubtaskServiceId = null;
            return;
        }

        const subtasks = [...(service.subtasks || [])];
        const [moved] = subtasks.splice(this.draggedSubtaskIndex, 1);
        subtasks.splice(targetIndex, 0, moved);

        const updatedSequence = subtasks.map((st, idx) => ({
            id: st.id,
            sequence_order: idx + 1
        }));

        const originalSubtasks = [...(service.subtasks || [])];
        service.subtasks = subtasks.map((st, idx) => ({ ...st, sequence_order: idx + 1 }));
        this.draggedSubtaskIndex = null;
        this.draggedSubtaskServiceId = null;

        this.sopService.reorderSubtasks(service.id, updatedSequence).subscribe({
            next: () => {
                this.showToast('✅ Subtask sequence updated successfully.', 'success');
            },
            error: (err) => {
                service.subtasks = originalSubtasks;
                this.showToast(err.error?.message || 'Could not save subtask order.', 'danger');
            }
        });
    }

    onSubtaskDateChange(service: SOPServiceItem, subtask: SOPSubtask, field: 'start_date' | 'end_date', event: any) {
        const newVal = event.target?.value;
        if (!newVal) return;
        const originalStart = subtask.start_date;
        const originalEnd = subtask.end_date;

        let proposedStart = field === 'start_date' ? newVal : (subtask.start_date ? this.formatDateForInput(subtask.start_date) : '');
        let proposedEnd = field === 'end_date' ? newVal : (subtask.end_date ? this.formatDateForInput(subtask.end_date) : '');

        const payload: any = {};
        if (field === 'start_date') {
            payload.start_date = newVal;
            // Auto-adjust end date if start date is moved beyond current end date
            if (proposedEnd && new Date(newVal).getTime() > new Date(proposedEnd).getTime()) {
                payload.end_date = newVal;
                proposedEnd = newVal;
            }
        } else if (field === 'end_date') {
            payload.end_date = newVal;
            // Auto-adjust start date if end date is moved before current start date
            if (proposedStart && new Date(newVal).getTime() < new Date(proposedStart).getTime()) {
                payload.start_date = newVal;
                proposedStart = newVal;
            }
        }

        this.sopService.updateSubtask(subtask.id, payload).subscribe({
            next: () => {
                this.showToast('✅ Subtask date updated.', 'success');
                if (payload.start_date !== undefined) subtask.start_date = payload.start_date;
                if (payload.end_date !== undefined) subtask.end_date = payload.end_date;
            },
            error: (err) => {
                this.showToast(err.error?.message || 'Failed to update subtask date.', 'danger');
                event.target.value = field === 'start_date' ? this.formatDateForInput(originalStart) : this.formatDateForInput(originalEnd);
            }
        });
    }

    get completedOrderDate(): string {
        if (!this.activeConversation) return '';
        const c: any = this.activeConversation;
        return c.updated_at || c.last_message_at || c.created_at || '';
    }

    // Subtasks Modals & Management
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
        this.editingSubtask = null;
        this.targetServiceForSubtask = null;
        this.newSubtask = { title: '', description: '', start_date: '', end_date: '', next_order_service_id: null };
    }

    /** Message when the sub task's end date is before its start date. */
    get subtaskDateError(): string {
        const { start_date, end_date } = this.newSubtask;
        if (start_date && end_date && new Date(start_date).getTime() > new Date(end_date).getTime()) {
            return 'End date cannot be before the start date.';
        }
        return '';
    }

    saveSubtask() {
        if (!this.newSubtask.title.trim()) {
            this.showToast('Please enter a subtask title.', 'warning');
            return;
        }
        if (this.subtaskDateError) {
            this.showToast(this.subtaskDateError, 'warning');
            return;
        }
        if (this.editingSubtask) {
            this.saveEditedSubtask();
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
                this.loadSopForActiveConversation(false);
            },
            error: (err) => {
                this.isSavingSubtask = false;
                this.showToast(err.error?.message || 'Failed to create subtask.', 'danger');
            }
        });
    }

    selectedProofImageUrl: string | null = null;

    openSubtaskDetails(st: SOPSubtask, service: SOPServiceItem, event?: Event) {
        if (event) event.stopPropagation();
        this.selectedSubtask = st;
        this.selectedSubtaskService = service;
        this.selectedProofImageUrl = this.getDefaultSubtaskProofUrl(st);
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

    openCompleteSubtaskModal(st: SOPSubtask, service?: SOPServiceItem, event?: Event) {
        if (event) event.stopPropagation();
        this.subtaskToComplete = st;
        this.serviceForSubtaskToComplete = service || null;
        this.completionDescription = st.description || '';
        this.completionImageFile = null;
        this.completionImagePreview = null;
        this.isCompletingSubtask = false;
        this.showCompleteSubtaskModal = true;
    }

    closeCompleteSubtaskModal() {
        if (this.isCompletingSubtask) return;
        this.showCompleteSubtaskModal = false;
        this.subtaskToComplete = null;
        this.serviceForSubtaskToComplete = null;
        this.completionDescription = '';
        this.completionImageFile = null;
        this.completionImagePreview = null;
    }

    completeSubtask(st: SOPSubtask, service?: SOPServiceItem, event?: Event) {
        this.openCompleteSubtaskModal(st, service, event);
    }

    markSubtaskDone(st: SOPSubtask, service?: SOPServiceItem, event?: Event) {
        this.openCompleteSubtaskModal(st, service, event);
    }

    onCompletionImageSelected(event: any) {
        const file = event.target?.files?.[0];
        if (!file) return;

        if (!file.type || !file.type.startsWith('image/')) {
            this.showToast('Please select a valid image file (PNG, JPG, JPEG, WEBP).', 'warning');
            return;
        }

        this.completionImageFile = file;
        const reader = new FileReader();
        reader.onload = (e: any) => {
            this.completionImagePreview = e.target.result;
        };
        reader.readAsDataURL(file);
    }

    removeCompletionImage() {
        this.completionImageFile = null;
        this.completionImagePreview = null;
    }

    submitCompleteSubtask() {
        if (!this.subtaskToComplete) return;

        if (!this.completionImageFile) {
            this.showToast('Please choose or click a photo before completing this subtask.', 'warning');
            return;
        }

        this.isCompletingSubtask = true;
        const st = this.subtaskToComplete;
        const notes = (this.completionDescription || '').trim();

        const updateDesc$ = (notes && notes !== (st.description || ''))
            ? this.sopService.updateSubtask(st.id, { description: notes })
            : null;

        const performCompletion = () => {
            this.sopService.uploadProof(st.id, this.completionImageFile!, true, notes).subscribe({
                next: () => {
                    this.isCompletingSubtask = false;
                    st.status = 'approval_pending';
                    if (notes) st.description = notes;
                    this.showToast(`Status updated to Approval Pending. "${st.title}" needs the customer's approval, please wait for their response.`, 'success');
                    this.closeCompleteSubtaskModal();
                    this.loadSopForActiveConversation(false);
                },
                error: (err: any) => {
                    this.isCompletingSubtask = false;
                    this.showToast(err.error?.message || 'Failed to complete subtask with proof.', 'danger');
                }
            });
        };

        if (updateDesc$) {
            updateDesc$.subscribe({
                next: () => performCompletion(),
                error: () => performCompletion()
            });
        } else {
            performCompletion();
        }
    }

    onProofFileSelected(event: any, st: SOPSubtask) {
        const file = event.target?.files?.[0];
        if (!file) return;

        this.isUploadingProof = true;
        this.sopService.uploadProof(st.id, file, false, this.proofNote).subscribe({
            next: (res: any) => {
                this.isUploadingProof = false;
                this.proofNote = '';
                this.showToast('✅ Completion proof uploaded successfully.', 'success');
                const uploadedUrl = res?.proof_image_url || res?.file_url || res?.data?.proof_image_url || res?.data?.file_url;
                if (this.selectedSubtask) {
                    if (uploadedUrl) {
                        this.selectedSubtask.proof_image_url = uploadedUrl;
                    }
                    if (res?.subtask?.proof_images) {
                        this.selectedSubtask.proof_images = res.subtask.proof_images;
                    } else if (uploadedUrl) {
                        if (!this.selectedSubtask.proof_images) this.selectedSubtask.proof_images = [];
                        this.selectedSubtask.proof_images.push({
                            id: Date.now(),
                            subtask_id: st.id,
                            image_url: uploadedUrl,
                            original_name: file.name
                        });
                    }
                }
                this.loadSopForActiveConversation(false);
            },
            error: (err) => {
                this.isUploadingProof = false;
                this.showToast(err.error?.message || 'Failed to upload proof.', 'danger');
            }
        });
    }

    hasSubtaskProof(): boolean {
        if (!this.selectedSubtask) return false;
        if (this.selectedSubtask.proof_image_url) return true;
        return !!(this.selectedSubtask.proof_images && this.selectedSubtask.proof_images.length > 0);
    }

    getSubtaskProofUrl(): string {
        return this.getActiveSubtaskProofUrl();
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
                original_name: 'Proof Photo'
            }];
        }
        return [];
    }

    getSubtaskDotClass(status?: string): string {
        if (status === 'completed') return 'dot-completed';
        if (status === 'approval_pending') return 'dot-approval';
        if (status === 'in_progress') return 'dot-in-progress';
        return 'dot-pending';
    }

    getSubtaskBadgeClass(status?: string): string {
        if (status === 'completed') return 'badge-completed';
        if (status === 'approval_pending') return 'badge-approval';
        if (status === 'in_progress') return 'badge-in-progress';
        return 'badge-pending';
    }

    getStatusText(status?: string): string {
        if (!status) return 'Pending';
        if (status === 'in_progress') return 'In Progress';
        if (status === 'completed') return 'Completed';
        if (status === 'approval_pending') return 'Approval Pending';
        return status.charAt(0).toUpperCase() + status.slice(1);
    }

    getProgressColor(status: string, percent?: number): string {
        if (status === 'completed' || percent === 100) return '#10b981';
        if (status === 'in_progress' || (percent && percent > 0)) return '#f59e0b';
        return '#94a3b8';
    }

    // ── Site Workflow: approval status, comments, editing ──

    getServiceStatusKey(s?: SOPServiceItem | null): string {
        if (!s) return 'pending';
        if (s.service_status !== 'completed' && s.completion_request?.status === 'pending') return 'approval_pending';
        return s.service_status || 'pending';
    }

    private get pendingApprovalServiceIds(): number[] {
        return (this.sopData?.services || [])
            .filter(s => s && this.getServiceStatusKey(s) === 'approval_pending')
            .map(s => Number(s.id));
    }

    /** One of my services is waiting for the customer to approve it. */
    get myServiceAwaitingApproval(): SOPServiceItem | null {
        const vid = this.currentVendorId;
        return (this.sopData?.services || []).find(
            s => s && (!vid || s.vendor_id == vid) && this.getServiceStatusKey(s) === 'approval_pending'
        ) || null;
    }

    /** My accepted, unfinished service that is not already waiting for approval. */
    private get serviceToSubmit(): any {
        const vid = this.currentVendorId;
        const pending = this.pendingApprovalServiceIds;
        const services = this.activeConversation?.services || [];
        return services.find((s: any) =>
            (!vid || s.vendor_id == vid) && s.vendor_status === 'accepted' &&
            s.service_status !== 'removed' && s.service_status !== 'completed' &&
            !pending.includes(Number(s.id))
        ) || this.myActiveService;
    }

    /** Latest customer feedback asking for changes on a service that is back in progress. */
    serviceChangesRequested(s?: SOPServiceItem | null): SOPComment | null {
        if (!s || s.service_status === 'completed' || this.getServiceStatusKey(s) === 'approval_pending') return null;
        const list = s.comments || [];
        const last = list.length > 0 ? list[list.length - 1] : null;
        return last && last.kind === 'changes_requested' ? last : null;
    }

    subtaskNeedsChanges(st?: SOPSubtask | null): boolean {
        if (!st || st.status === 'completed' || st.status === 'approval_pending') return false;
        const list = st.comments || [];
        return list.length > 0 && list[list.length - 1].kind === 'changes_requested';
    }

    subtaskCommentCount(st?: SOPSubtask | null): number {
        if (!st) return 0;
        if (typeof st.comments_count === 'number') return st.comments_count;
        return (st.comments || []).filter(c => !!c.comment).length;
    }

    canEditSubtask(st?: SOPSubtask | null): boolean {
        return !!st && !this.isOrderClosed && st.status !== 'completed';
    }

    canMarkSubtaskDone(st?: SOPSubtask | null): boolean {
        return !!st && !this.isOrderClosed && st.status !== 'completed' && st.status !== 'approval_pending';
    }

    private findServiceOfSubtask(st: SOPSubtask): SOPServiceItem | null {
        return (this.sopData?.services || []).find(s => s && s.id === st.order_service_id) || null;
    }

    openEditSubtask(st: SOPSubtask, service?: SOPServiceItem | null, event?: Event) {
        if (event) event.stopPropagation();
        if (!this.canEditSubtask(st)) return;
        if (this.showSubtaskDetailsModal) this.closeSubtaskDetailsModal();
        this.editingSubtask = st;
        this.targetServiceForSubtask = service || this.findServiceOfSubtask(st) || this.selectedSopService;
        this.newSubtask = {
            title: st.title || '',
            description: st.description || '',
            start_date: st.start_date ? this.formatDateForInput(st.start_date) : '',
            end_date: st.end_date ? this.formatDateForInput(st.end_date) : '',
            next_order_service_id: st.next_order_service_id ? Number(st.next_order_service_id) : null
        };
        this.showAddSubtaskModal = true;
    }

    private saveEditedSubtask() {
        const st = this.editingSubtask;
        if (!st) return;
        if (this.newSubtask.start_date && this.newSubtask.end_date &&
            new Date(this.newSubtask.start_date).getTime() > new Date(this.newSubtask.end_date).getTime()) {
            this.showToast('Start date cannot be after the end date.', 'warning');
            return;
        }
        this.isSavingSubtask = true;
        this.sopService.updateSubtask(st.id, {
            title: this.newSubtask.title.trim(),
            description: this.newSubtask.description.trim(),
            start_date: this.newSubtask.start_date || null,
            end_date: this.newSubtask.end_date || null,
            next_order_service_id: this.newSubtask.next_order_service_id ? Number(this.newSubtask.next_order_service_id) : null
        }).subscribe({
            next: () => {
                this.isSavingSubtask = false;
                this.closeAddSubtaskModal();
                this.showToast('Sub task updated.', 'success');
                this.loadSopForActiveConversation(false);
            },
            error: (err) => {
                this.isSavingSubtask = false;
                this.showToast(err.error?.message || 'Could not update the sub task.', 'danger');
            }
        });
    }

    openEditService(s: SOPServiceItem | null, event?: Event) {
        if (event) event.stopPropagation();
        if (!s || this.isOrderClosed) return;
        this.editServiceTarget = s;
        this.editServiceForm = {
            start_date: s.start_date ? this.formatDateForInput(s.start_date) : '',
            end_date: s.end_date ? this.formatDateForInput(s.end_date) : '',
            description: s.description || ''
        };
        this.showEditServiceModal = true;
    }

    closeEditServiceModal() {
        if (this.isSavingService) return;
        this.showEditServiceModal = false;
        this.editServiceTarget = null;
    }

    saveEditedService() {
        const s = this.editServiceTarget;
        if (!s) return;
        const f = this.editServiceForm;
        if (f.start_date && f.end_date && new Date(f.start_date).getTime() > new Date(f.end_date).getTime()) {
            this.showToast('Start date cannot be after the end date.', 'warning');
            return;
        }
        this.isSavingService = true;
        this.sopService.updateService(s.id, {
            start_date: f.start_date || undefined,
            end_date: f.end_date || undefined,
            description: f.description.trim()
        }).subscribe({
            next: () => {
                this.isSavingService = false;
                this.closeEditServiceModal();
                this.showToast('Service details updated.', 'success');
                this.loadSopForActiveConversation(false);
            },
            error: (err) => {
                this.isSavingService = false;
                this.showToast(err.error?.message || 'Could not update the service.', 'danger');
            }
        });
    }

    openSubtaskComments(st: SOPSubtask, event?: Event) {
        if (event) event.stopPropagation();
        if (this.showSubtaskDetailsModal) this.closeSubtaskDetailsModal();
        this.commentsTarget = { kind: 'subtask', id: st.id, title: st.title };
        this.newComment = '';
        this.showCommentsModal = true;
    }

    openServiceComments(s: SOPServiceItem, event?: Event) {
        if (event) event.stopPropagation();
        this.commentsTarget = { kind: 'service', id: s.id, title: s.service_name || s.subcategory_name || 'Service' };
        this.newComment = '';
        this.showCommentsModal = true;
    }

    closeCommentsModal() {
        if (this.isPostingComment) return;
        this.showCommentsModal = false;
        this.commentsTarget = null;
        this.newComment = '';
    }

    get commentsList(): SOPComment[] {
        const t = this.commentsTarget;
        if (!t) return [];
        for (const s of this.sopData?.services || []) {
            if (!s) continue;
            if (t.kind === 'service' && s.id === t.id) return s.comments || [];
            if (t.kind === 'subtask') {
                const st = (s.subtasks || []).find(x => x && x.id === t.id);
                if (st) return st.comments || [];
            }
        }
        return [];
    }

    getCommentKindLabel(kind?: string): string {
        if (kind === 'approval_requested') return 'Sent for approval';
        if (kind === 'changes_requested') return 'Changes requested';
        if (kind === 'approved') return 'Approved';
        return 'Comment';
    }

    postComment() {
        const t = this.commentsTarget;
        const text = this.newComment.trim();
        if (!t || t.kind !== 'subtask' || !text) return;
        this.isPostingComment = true;
        this.sopService.addSubtaskComment(t.id, text).subscribe({
            next: () => {
                this.isPostingComment = false;
                this.newComment = '';
                this.showToast('Comment sent to the customer.', 'success');
                this.loadSopForActiveConversation(false);
            },
            error: (err) => {
                this.isPostingComment = false;
                this.showToast(err.error?.message || 'Could not post your comment.', 'danger');
            }
        });
    }

    // ── Media and File Helpers ──

    private scrollToBottom() {
        setTimeout(() => {
            if (this.messagesContainer?.nativeElement) {
                this.messagesContainer.nativeElement.scrollTop = this.messagesContainer.nativeElement.scrollHeight;
            }
        }, 100);
    }

    openImagePreview(target: string | ChatMessage | any) {
        this.previewImageUrl = this.getMediaUrl(target);
    }

    closeImagePreview() {
        this.previewImageUrl = null;
    }

    getMediaUrl(target?: string | ChatMessage | any): string {
        if (!target) return '';
        let url = typeof target === 'string' ? target : (target.attachment_url || target.file_url || target.image_url || '');
        if (!url) return '';
        if (url.startsWith('http://') || url.startsWith('https://') || url.startsWith('data:')) return url;
        const clean = url.startsWith('/') ? url : `/${url}`;
        const base = environment.apiUrl.replace(/\/api\/v1\/?$/, '');
        return `${base}${clean}`;
    }

    isImageMessage(m: any): boolean {
        if (!m || this.isCompletionRequestMessage(m) || this.isWorkCompletedMessage(m)) return false;
        if (m.message_type === 'image') return true;
        if (m.message_type === 'video' || m.message_type === 'audio' || m.message_type === 'pdf') return false;
        const target = (m.attachment_name || m.file_name || m.attachment_url || m.file_url || m.content || '').toLowerCase();
        return /\.(png|jpe?g|webp|gif|svg|bmp)$/i.test(target);
    }

    isVideoMessage(m: any): boolean {
        if (!m || this.isCompletionRequestMessage(m) || this.isWorkCompletedMessage(m)) return false;
        if (m.message_type === 'audio' || m.message_type === 'image' || m.message_type === 'pdf') return false;
        const mime = (m.attachment_mime || m.file_type || '').toLowerCase();
        if (mime.startsWith('audio/')) return false;
        if (m.message_type === 'video' || mime.startsWith('video/')) return true;

        const name = (m.attachment_name || m.file_name || '').toLowerCase();
        if (name.startsWith('voice_note_') || name.startsWith('audio_')) return false;

        const target = (m.attachment_name || m.file_name || m.attachment_url || m.file_url || m.content || '').toLowerCase();
        if (target.includes('voice_note') || target.includes('voice-note') || target.includes('audio_')) return false;

        return /\.(mp4|mov|avi|mkv)$/i.test(target) || (/\.webm$/i.test(target) && !mime.includes('audio'));
    }

    isAudioMessage(m: any): boolean {
        if (!m || this.isCompletionRequestMessage(m) || this.isWorkCompletedMessage(m)) return false;
        if (m.message_type === 'video' || m.message_type === 'image' || m.message_type === 'pdf') return false;
        const mime = (m.attachment_mime || m.file_type || '').toLowerCase();
        if (mime.startsWith('video/')) return false;
        if (m.message_type === 'audio' || mime.startsWith('audio/')) return true;

        const name = (m.attachment_name || m.file_name || '').toLowerCase();
        if (name.startsWith('voice_note_') || name.startsWith('audio_')) return true;

        const target = (m.attachment_name || m.file_name || m.attachment_url || m.file_url || m.content || '').toLowerCase();
        if (target.includes('voice_note') || target.includes('voice-note') || target.includes('audio_')) return true;

        return /\.(mp3|wav|ogg|m4a|aac)$/i.test(target) || (/\.webm$/i.test(target) && (target.includes('voice') || target.includes('audio') || mime.includes('audio')));
    }

    isDocMessage(m: any): boolean {
        if (!m || this.isCompletionRequestMessage(m) || this.isWorkCompletedMessage(m)) return false;
        if (this.isImageMessage(m) || this.isVideoMessage(m) || this.isAudioMessage(m)) return false;
        return m.message_type === 'pdf' || m.message_type === 'document' || !!(m.attachment_url || m.file_url);
    }

    isPdfMessage(m: any): boolean {
        if (!m) return false;
        if (m.message_type === 'pdf') return true;
        const target = (m.attachment_name || m.file_name || m.attachment_url || m.file_url || m.content || '').toLowerCase();
        return target.endsWith('.pdf');
    }

    getDocIcon(m: any): string {
        const name = (m.attachment_name || m.file_name || m.content || '').toLowerCase();
        if (name.endsWith('.pdf') || m.message_type === 'pdf') return 'document-text';
        if (name.endsWith('.doc') || name.endsWith('.docx')) return 'document';
        if (name.endsWith('.xls') || name.endsWith('.xlsx') || name.endsWith('.csv')) return 'grid';
        if (name.endsWith('.ppt') || name.endsWith('.pptx')) return 'easel';
        if (name.endsWith('.zip') || name.endsWith('.rar')) return 'archive';
        return 'attach';
    }

    getDocIconClass(m: any): string {
        const name = (m.attachment_name || m.file_name || m.content || '').toLowerCase();
        if (name.endsWith('.pdf') || m.message_type === 'pdf') return 'doc-pdf';
        if (name.endsWith('.doc') || name.endsWith('.docx')) return 'doc-word';
        if (name.endsWith('.xls') || name.endsWith('.xlsx') || name.endsWith('.csv')) return 'doc-excel';
        return 'doc-generic';
    }

    formatFileSize(bytes?: number): string {
        if (!bytes) return '';
        if (bytes < 1024) return bytes + ' B';
        if (bytes < 1024 * 1024) return (bytes / 1024).toFixed(1) + ' KB';
        return (bytes / (1024 * 1024)).toFixed(1) + ' MB';
    }

    onEditOrderClicked() {
        if (this.activeConversation) {
            this.editOrderRequested.emit(this.activeConversation);
        }
    }

    private async showToast(message: string, color: string = 'dark') {
        const toast = await this.toastCtrl.create({
            message,
            duration: 3500,
            position: 'top',
            color
        });
        await toast.present();
    }
}
