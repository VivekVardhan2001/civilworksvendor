import { Injectable, NgZone } from '@angular/core';
import { HttpClient } from '@angular/common/http';
import { BehaviorSubject, Observable, Subject } from 'rxjs';
import { tap } from 'rxjs/operators';
import { io, Socket } from 'socket.io-client';
import { environment } from '../../environments/environment';
import { AuthService } from './auth.service';

export interface ChatMessage {
    id?: number;
    conversation_id: number;
    sender_id?: number;
    sender_type: 'customer' | 'vendor' | 'system';
    sender_name: string;
    message_type: 'text' | 'image' | 'video' | 'audio' | 'pdf' | 'document' | 'system';
    content: string;
    attachment_url?: string;
    attachment_name?: string;
    attachment_size?: number;
    attachment_mime?: string;
    file_url?: string;
    file_name?: string;
    file_size?: number;
    file_type?: string;
    created_at?: string;
    formatted_time?: string;
    is_read?: boolean | number;
}

export interface Conversation {
    id: number;
    order_id: number;
    order_no: string;
    title: string;
    conversation_status: string;
    order_status: string;
    order_type: string;
    total_amount: number;
    status_priority: number;
    last_message?: string;
    last_message_type?: string;
    last_sender_name?: string;
    last_message_at?: string;
    unread_count?: number;
    participants?: any[];
    services?: any[];
    customer_name?: string;
    customer_mobile?: string;
    customer_user_id?: number;
    customer_organization?: string;
}

@Injectable({
    providedIn: 'root'
})
export class ChatService {
    private socket: Socket | null = null;
    private socketUrl: string;

    private conversationsSubject = new BehaviorSubject<Conversation[]>([]);
    public conversations$ = this.conversationsSubject.asObservable();

    private activeConversationSubject = new BehaviorSubject<Conversation | null>(null);
    public activeConversation$ = this.activeConversationSubject.asObservable();

    private messagesSubject = new BehaviorSubject<ChatMessage[]>([]);
    public messages$ = this.messagesSubject.asObservable();

    private unreadCountSubject = new BehaviorSubject<number>(0);
    public unreadCount$ = this.unreadCountSubject.asObservable();

    private typingUsersSubject = new BehaviorSubject<{ [conversationId: number]: string[] }>({});
    public typingUsers$ = this.typingUsersSubject.asObservable();

    private sopUpdatedSubject = new Subject<{ event: string, data: any }>();
    public sopUpdated$ = this.sopUpdatedSubject.asObservable();

    private orderEventSubject = new Subject<{ event: string, data: any }>();
    public orderEvent$ = this.orderEventSubject.asObservable();

    public getSocket(): Socket | null {
        return this.socket;
    }

    constructor(
        private http: HttpClient,
        private authService: AuthService,
        private ngZone: NgZone
    ) {
        // Socket host from apiUrl
        this.socketUrl = environment.apiUrl.replace(/\/api\/v1\/?$/, '');

        this.authService.user$.subscribe(user => {
            if (user) {
                this.initSocket();
                this.loadConversations().subscribe({ error: () => {} });
            } else {
                const token = localStorage.getItem('civilworks_token') || localStorage.getItem('civilworks_vendor_token');
                if (token) {
                    this.initSocket();
                    this.loadConversations().subscribe({ error: () => {} });
                } else {
                    this.disconnectSocket();
                    this.conversationsSubject.next([]);
                    this.activeConversationSubject.next(null);
                    this.messagesSubject.next([]);
                    this.unreadCountSubject.next(0);
                }
            }
        });
    }

    public ensureSocketConnected() {
        if (!this.socket || !this.socket.connected) {
            this.initSocket();
        }
    }

    private initSocket() {
        if (this.socket && this.socket.connected) return;

        try {
            if (this.socket) {
                this.socket.connect();
                return;
            }

            this.socket = io(this.socketUrl, {
                transports: ['websocket', 'polling'],
                autoConnect: true,
                reconnection: true,
                reconnectionAttempts: 10,
                reconnectionDelay: 1000
            });

            this.socket.on('connect', () => {
                this.ngZone.run(() => {
                    console.log('[ChatService] Socket connected to:', this.socketUrl);
                    const active = this.activeConversationSubject.value;
                    if (active) {
                        this.joinConversationRoom(active.id);
                        if (active.order_id) {
                            this.joinOrderRoom(active.order_id);
                        }
                    }
                    const curUser: any = this.authService.getUser();
                    const vId = curUser?.vendor_id || curUser?.id;
                    if (vId) {
                        this.joinVendorRoom(vId);
                    }
                });
            });

            this.socket.on('new_message', (msg: any) => {
                this.ngZone.run(() => {
                    const normalized: ChatMessage = {
                        ...msg,
                        conversation_id: Number(msg.conversation_id),
                        attachment_url: msg.file_url || msg.attachment_url,
                        attachment_name: msg.file_name || msg.attachment_name || msg.content,
                        attachment_size: msg.file_size || msg.attachment_size,
                        attachment_mime: msg.file_type || msg.attachment_mime
                    };
                    const active = this.activeConversationSubject.value;
                    if (active && Number(active.id) === Number(normalized.conversation_id)) {
                        const isCompleted = this.isVendorWorkCompleted(active);
                        const isCompletionMsg = normalized.file_type === 'work_completed' || 
                            (normalized.message_type as string) === 'work_completed' || 
                            !!(normalized.content && normalized.content.startsWith('Work completed:'));

                        // If this vendor's work is completed, do NOT append messages sent after completion
                        if (!isCompleted || isCompletionMsg) {
                            const currentMessages = this.messagesSubject.value;
                            if (!currentMessages.some(m => m.id != null && normalized.id != null && Number(m.id) === Number(normalized.id))) {
                                this.messagesSubject.next([...currentMessages, normalized]);
                            }
                        }
                    }
                    this.loadConversations().subscribe({ error: () => {} });
                });
            });

            this.socket.on('conversation_message_received', (data: any) => {
                this.ngZone.run(() => {
                    const msg = data?.message;
                    if (msg) {
                        const normalized: ChatMessage = {
                            ...msg,
                            conversation_id: Number(msg.conversation_id || data?.conversation_id),
                            attachment_url: msg.file_url || msg.attachment_url,
                            attachment_name: msg.file_name || msg.attachment_name || msg.content,
                            attachment_size: msg.file_size || msg.attachment_size,
                            attachment_mime: msg.file_type || msg.attachment_mime
                        };
                        const active = this.activeConversationSubject.value;
                        const matchConv = active && (Number(active.id) === Number(normalized.conversation_id));
                        const matchOrder = active && active.order_id && data?.order_id && (Number(active.order_id) === Number(data.order_id));
                        if (matchConv || matchOrder) {
                            const isCompleted = this.isVendorWorkCompleted(active);
                            const isCompletionMsg = normalized.file_type === 'work_completed' || 
                                (normalized.message_type as string) === 'work_completed' || 
                                !!(normalized.content && normalized.content.startsWith('Work completed:'));

                            if (!isCompleted || isCompletionMsg) {
                                const currentMessages = this.messagesSubject.value;
                                if (!currentMessages.some(m => m.id != null && normalized.id != null && Number(m.id) === Number(normalized.id))) {
                                    this.messagesSubject.next([...currentMessages, normalized]);
                                }
                            }
                        }
                    }
                    this.loadConversations().subscribe({ error: () => {} });
                });
            });

            this.socket.on('user_typing', (data: { conversationId: number, senderName: string, isTyping: boolean }) => {
                this.ngZone.run(() => {
                    const current = { ...this.typingUsersSubject.value };
                    const list = current[data.conversationId] || [];
                    if (data.isTyping) {
                        if (!list.includes(data.senderName)) {
                            current[data.conversationId] = [...list, data.senderName];
                        }
                    } else {
                        current[data.conversationId] = list.filter(n => n !== data.senderName);
                    }
                    this.typingUsersSubject.next(current);
                });
            });

            this.socket.on('service_added', () => {
                this.ngZone.run(() => {
                    this.loadConversations().subscribe({ error: () => {} });
                });
            });

            this.socket.on('service_removed', () => {
                this.ngZone.run(() => {
                    this.loadConversations().subscribe({ error: () => {} });
                });
            });

            this.socket.on('vendor_status_updated', (data: any) => {
                this.ngZone.run(() => {
                    const active = this.activeConversationSubject.value;
                    if (active && (Number(active.id) === Number(data?.conversation_id) || Number(active.order_id) === Number(data?.order_id))) {
                        if (data?.services) {
                            this.activeConversationSubject.next({ ...active, services: data.services });
                        } else if (active.services) {
                            const updated = active.services.map((s: any) => {
                                if (Number(s.id) === Number(data?.service_id)) {
                                    return { ...s, vendor_status: data.vendor_status || 'accepted', service_status: data.service_status || 'in_progress' };
                                }
                                return s;
                            });
                            this.activeConversationSubject.next({ ...active, services: updated });
                        }
                    }
                    this.orderEventSubject.next({ event: 'vendor_status_updated', data });
                    this.loadConversations().subscribe({ error: () => {} });
                });
            });

            this.socket.on('work_status_updated', (data: any) => {
                this.ngZone.run(() => {
                    const active = this.activeConversationSubject.value;
                    if (active && (Number(active.id) === Number(data?.conversation_id) || Number(active.order_id) === Number(data?.order_id))) {
                        if (data.services) {
                            this.activeConversationSubject.next({ ...active, services: data.services });
                        } else if (active.services) {
                            const updated = active.services.map((s: any) => {
                                if (Number(s.id) === Number(data?.service_id)) {
                                    return { ...s, service_status: data.service_status || 'completed' };
                                }
                                return s;
                            });
                            this.activeConversationSubject.next({ ...active, services: updated });
                        }
                    }
                    this.orderEventSubject.next({ event: 'work_status_updated', data });
                    this.loadConversations().subscribe({ error: () => {} });
                });
            });

            this.socket.on('order_completed', (data: any) => {
                this.ngZone.run(() => {
                    const active = this.activeConversationSubject.value;
                    if (active && (Number(active.id) === Number(data?.conversation_id) || Number(active.order_id) === Number(data?.order_id))) {
                        this.activeConversationSubject.next({
                            ...active,
                            order_status: 'delivered',
                            conversation_status: 'closed',
                            services: data.services || active.services
                        });
                    }
                    this.orderEventSubject.next({ event: 'order_completed', data });
                    this.loadConversations().subscribe({ error: () => {} });
                });
            });

            // Register SOP real-time event listeners
            const sopEvents = [
                'sop_sequence_updated',
                'sop_service_updated',
                'sop_subtask_created',
                'sop_subtask_updated',
                'sop_subtasks_reordered',
                'sop_subtask_deleted',
                'sop_subtask_completed',
                'sop_proof_uploaded',
                'sop_completion_requested',
                'sop_completion_responded'
            ];
            sopEvents.forEach(evt => {
                this.socket!.on(evt, (data: any) => {
                    this.ngZone.run(() => {
                        this.sopUpdatedSubject.next({ event: evt, data });
                    });
                });
            });

            // Register Order & Request real-time event listeners
            const orderEvents = [
                'order_created',
                'new_service_request',
                'order_service_added',
                'order_service_removed',
                'order_service_updated',
                'order_status_updated'
            ];
            orderEvents.forEach(evt => {
                this.socket!.on(evt, (data: any) => {
                    this.ngZone.run(() => {
                        this.orderEventSubject.next({ event: evt, data });
                    });
                });
            });

        } catch (e) {
            console.warn('[ChatService] Socket initialization error:', e);
        }
    }

    public disconnectSocket() {
        if (this.socket) {
            this.socket.disconnect();
            this.socket = null;
        }
    }

    public joinConversationRoom(conversationId: number | string) {
        if (!this.socket) {
            this.initSocket();
        }
        if (this.socket) {
            this.socket.emit('join_conversation', Number(conversationId));
            this.socket.emit('join_conversation', String(conversationId));
        }
    }

    public leaveConversationRoom(conversationId: number | string) {
        if (this.socket) {
            this.socket.emit('leave_conversation', Number(conversationId));
            this.socket.emit('leave_conversation', String(conversationId));
        }
    }

    public joinOrderRoom(orderId: number | string) {
        if (!this.socket) {
            this.initSocket();
        }
        if (this.socket) {
            this.socket.emit('join_order', Number(orderId));
            this.socket.emit('join_order', String(orderId));
        }
    }

    public leaveOrderRoom(orderId: number | string) {
        if (this.socket) {
            this.socket.emit('leave_order', Number(orderId));
            this.socket.emit('leave_order', String(orderId));
        }
    }

    public joinVendorRoom(vendorId: number | string) {
        if (!this.socket) {
            this.initSocket();
        }
        if (this.socket) {
            this.socket.emit('join_vendor', Number(vendorId));
            this.socket.emit('join_vendor', String(vendorId));
        }
    }

    public leaveVendorRoom(vendorId: number | string) {
        if (this.socket) {
            this.socket.emit('leave_vendor', Number(vendorId));
            this.socket.emit('leave_vendor', String(vendorId));
        }
    }

    public sendTyping(conversationId: number, senderName: string, isTyping: boolean) {
        if (!this.socket) {
            this.initSocket();
        }
        if (this.socket) {
            this.socket.emit('typing', { conversationId, senderName, isTyping });
        }
    }

    // ── HTTP Endpoints ──

    loadConversations(): Observable<any> {
        return this.http.get<any>(`${environment.apiUrl}/chat/conversations`).pipe(
            tap(res => {
                const convs = res.data || [];
                this.conversationsSubject.next(convs);
                const totalUnread = convs.reduce((sum: number, c: Conversation) => sum + (c.unread_count || 0), 0);
                this.unreadCountSubject.next(totalUnread);
            })
        );
    }

    setActiveConversation(conversation: Conversation | null) {
        const prev = this.activeConversationSubject.value;
        if (prev && conversation && prev.id === conversation.id) {
            // Already active! Don't churn socket rooms or re-request messages
            return;
        }

        if (prev) {
            this.leaveConversationRoom(prev.id);
        }

        this.activeConversationSubject.next(conversation);
        if (conversation) {
            this.joinConversationRoom(conversation.id);
            this.loadMessages(conversation.id).subscribe({ error: () => {} });
        } else {
            this.messagesSubject.next([]);
        }
    }

    loadMessages(conversationId: number): Observable<any> {
        return this.http.get<any>(`${environment.apiUrl}/chat/conversations/${conversationId}/messages`).pipe(
            tap(res => {
                const rawMsgs = res.data?.messages || [];
                const normalized: ChatMessage[] = rawMsgs.map((m: any) => ({
                    ...m,
                    attachment_url: m.attachment_url || m.file_url,
                    attachment_name: m.attachment_name || m.file_name || m.content,
                    attachment_size: m.attachment_size || m.file_size,
                    attachment_mime: m.attachment_mime || m.file_type
                }));
                this.messagesSubject.next(normalized);
                // Update activeConversation if fresh conversation details returned
                if (res.data?.conversation) {
                    const freshConv = res.data.conversation;
                    const curActive = this.activeConversationSubject.value;
                    if (curActive && curActive.id === conversationId) {
                        this.activeConversationSubject.next({
                            ...curActive,
                            ...freshConv
                        });
                    }
                }
                // Update local unread counter for this conversation
                const convs = this.conversationsSubject.value.map(c => {
                    if (c.id === conversationId) {
                        return { ...c, unread_count: 0 };
                    }
                    return c;
                });
                this.conversationsSubject.next(convs);
                const totalUnread = convs.reduce((sum: number, c: Conversation) => sum + (c.unread_count || 0), 0);
                this.unreadCountSubject.next(totalUnread);
            })
        );
    }

    sendMessage(conversationId: number, data: {
        content: string;
        message_type?: string;
        attachment_url?: string;
        attachment_name?: string;
        attachment_size?: number;
        attachment_mime?: string;
        file_url?: string;
        file_name?: string;
        file_size?: number;
        file_type?: string;
    }): Observable<any> {
        const payload = {
            ...data,
            file_url: data.file_url || data.attachment_url,
            file_name: data.file_name || data.attachment_name,
            file_size: data.file_size || data.attachment_size,
            file_type: data.file_type || data.attachment_mime,
            attachment_url: data.attachment_url || data.file_url,
            attachment_name: data.attachment_name || data.file_name,
            attachment_size: data.attachment_size || data.file_size,
            attachment_mime: data.attachment_mime || data.file_type
        };
        return this.http.post<any>(`${environment.apiUrl}/chat/conversations/${conversationId}/messages`, payload).pipe(
            tap(res => {
                const sentMsg = res.data;
                const normalized: ChatMessage = {
                    ...sentMsg,
                    attachment_url: sentMsg.attachment_url || sentMsg.file_url,
                    attachment_name: sentMsg.attachment_name || sentMsg.file_name || sentMsg.content,
                    attachment_size: sentMsg.attachment_size || sentMsg.file_size,
                    attachment_mime: sentMsg.attachment_mime || sentMsg.file_type
                };
                const current = this.messagesSubject.value;
                if (!current.some(m => m.id === normalized.id)) {
                    this.messagesSubject.next([...current, normalized]);
                }
            })
        );
    }

    uploadAttachment(file: File): Observable<any> {
        const formData = new FormData();
        formData.append('file', file);
        return this.http.post<any>(`${environment.apiUrl}/chat/upload`, formData);
    }

    requestCompletion(conversationId: number, serviceId?: number): Observable<any> {
        return this.http.post<any>(`${environment.apiUrl}/chat/conversations/${conversationId}/request-completion`, {
            service_id: serviceId
        }).pipe(
            tap(res => {
                if (res.data) {
                    const active = this.activeConversationSubject.value;
                    if (active && active.id === conversationId) {
                        const current = this.messagesSubject.value;
                        if (!current.some(m => m.id === res.data.id)) {
                            this.messagesSubject.next([...current, res.data]);
                        }
                    }
                }
            })
        );
    }

    completeWork(conversationId: number, serviceId?: number, vendorId?: number): Observable<any> {
        return this.http.post<any>(`${environment.apiUrl}/chat/conversations/${conversationId}/complete-work`, {
            service_id: serviceId,
            vendor_id: vendorId
        }).pipe(
            tap(res => {
                if (res.data?.services) {
                    const active = this.activeConversationSubject.value;
                    if (active && active.id === conversationId) {
                        this.activeConversationSubject.next({
                            ...active,
                            services: res.data.services
                        });
                    }
                }
                this.loadConversations().subscribe({ error: () => {} });
            })
        );
    }

    completeOrder(conversationId: number): Observable<any> {
        return this.http.post<any>(`${environment.apiUrl}/chat/conversations/${conversationId}/complete-order`, {}).pipe(
            tap(res => {
                if (res.data) {
                    const active = this.activeConversationSubject.value;
                    if (active && active.id === conversationId) {
                        this.activeConversationSubject.next({
                            ...active,
                            order_status: 'delivered',
                            conversation_status: 'closed',
                            services: res.data.services || active.services
                        });
                    }
                }
                this.loadConversations().subscribe({ error: () => {} });
            })
        );
    }

    public getCurrentVendorId(): number | null {
        const user: any = this.authService.getUser();
        if (user?.vendor_id) return Number(user.vendor_id);
        if (user?.role === 'vendor') return Number(user.id);
        const raw = localStorage.getItem('civilworks_vendor_user') || localStorage.getItem('civilworks_user');
        if (raw) {
            try {
                const u = JSON.parse(raw);
                if (u.vendor_id) return Number(u.vendor_id);
                if (u.role === 'vendor') return Number(u.id);
            } catch (e) {}
        }
        return null;
    }

    public isVendorWorkCompleted(conversation: Conversation | null): boolean {
        if (!conversation || !conversation.services) return false;
        const vid = this.getCurrentVendorId();
        if (!vid) return false;
        const myServices = conversation.services.filter(
            (s: any) => s.vendor_id == vid && s.service_status !== 'removed'
        );
        return myServices.length > 0 && myServices.every((s: any) => s.service_status === 'completed');
    }
}

