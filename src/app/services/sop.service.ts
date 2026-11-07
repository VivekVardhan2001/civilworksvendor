import { Injectable } from '@angular/core';
import { HttpClient } from '@angular/common/http';
import { Observable } from 'rxjs';
import { map } from 'rxjs/operators';
import { environment } from '../../environments/environment';

export interface SubtaskProofImage {
    id: number;
    subtask_id: number;
    image_url: string;
    original_name?: string;
    file_size?: number;
    created_at?: string;
}

export interface SOPComment {
    id: number;
    order_id: number;
    order_service_id?: number | null;
    subtask_id?: number | null;
    author_type: 'customer' | 'vendor' | 'admin' | 'system';
    author_id?: number | null;
    author_name?: string | null;
    kind: 'comment' | 'approval_requested' | 'approved' | 'changes_requested' | string;
    comment?: string | null;
    created_at?: string;
}

export interface SOPSubtask {
    id: number;
    order_service_id: number;
    order_id: number;
    vendor_id: number;
    title: string;
    description?: string;
    start_date?: string;
    end_date?: string;
    status: 'pending' | 'in_progress' | 'approval_pending' | 'completed';
    sequence_order: number;
    next_order_service_id?: number | null;
    comments?: SOPComment[];
    comments_count?: number;
    completed_at?: string;
    proof_image_url?: string;
    proof_images?: SubtaskProofImage[];
}

export interface SOPServiceItem {
    id: number;
    order_id: number;
    subcategory_id: number;
    service_name: string;
    subcategory_name?: string;
    vendor_id: number;
    vendor_name?: string;
    vendor_mobile?: string;
    vendor_status: string;
    service_status: 'pending' | 'in_progress' | 'completed' | 'cancelled' | 'removed';
    price: number | string;
    sequence_order: number;
    description?: string;
    start_date?: string;
    end_date?: string;
    progress_percent: number;
    calculated_progress?: number;
    subtasks?: SOPSubtask[];
    completion_request?: any;
    comments?: SOPComment[];
    expanded?: boolean;
}

export interface OrderSOPData {
    id: number;
    order_no: string;
    project_name?: string;
    user_id: number;
    order_status: string;
    total_amount: number | string;
    created_at: string;
    customer_id: number;
    customer_name?: string;
    customer_organization?: string;
    customer_mobile?: string;
    customer_email?: string;
    vendor?: {
        id?: number;
        name?: string;
        mobile?: string;
        email?: string;
    };
    services: SOPServiceItem[];
}

@Injectable({
    providedIn: 'root'
})
export class SOPService {
    constructor(private http: HttpClient) { }

    getEligibleOrders(): Observable<any[]> {
        return this.http.get<any>(`${environment.apiUrl}/sop/orders`)
            .pipe(map(res => res.data || []));
    }

    getOrderSOP(orderId: number | string): Observable<OrderSOPData> {
        return this.http.get<any>(`${environment.apiUrl}/sop/orders/${orderId}`)
            .pipe(map(res => res.data));
    }

    reorderServices(orderId: number | string, services: { id: number; sequence_order: number }[]): Observable<any> {
        return this.http.put<any>(`${environment.apiUrl}/sop/orders/${orderId}/sequence`, { services })
            .pipe(map(res => res.data));
    }

    updateService(serviceId: number | string, data: { start_date?: string; end_date?: string; description?: string }): Observable<any> {
        return this.http.put<any>(`${environment.apiUrl}/sop/services/${serviceId}`, data)
            .pipe(map(res => res.data));
    }

    createSubtask(serviceId: number | string, data: { title: string; description?: string; start_date?: string; end_date?: string; next_order_service_id?: number | null; next_vendor_id?: number | null }): Observable<SOPSubtask> {
        return this.http.post<any>(`${environment.apiUrl}/sop/services/${serviceId}/subtasks`, data)
            .pipe(map(res => res.data));
    }

    reorderSubtasks(serviceId: number | string, subtasks: { id: number; sequence_order: number }[]): Observable<any> {
        return this.http.put<any>(`${environment.apiUrl}/sop/services/${serviceId}/subtasks/sequence`, { subtasks })
            .pipe(map(res => res.data));
    }

    updateSubtask(subtaskId: number | string, data: any): Observable<SOPSubtask> {
        return this.http.put<any>(`${environment.apiUrl}/sop/subtasks/${subtaskId}`, data)
            .pipe(map(res => res.data));
    }

    deleteSubtask(subtaskId: number | string): Observable<any> {
        return this.http.delete<any>(`${environment.apiUrl}/sop/subtasks/${subtaskId}`)
            .pipe(map(res => res.data));
    }

    completeSubtask(subtaskId: number | string): Observable<SOPSubtask> {
        return this.http.post<any>(`${environment.apiUrl}/sop/subtasks/${subtaskId}/complete`, {})
            .pipe(map(res => res.data));
    }

    uploadProof(subtaskId: number | string, file: File, markCompleted = false, notes = ''): Observable<any> {
        const formData = new FormData();
        formData.append('image', file);
        if (markCompleted) formData.append('mark_completed', 'true');
        if (notes) formData.append('notes', notes);

        return this.http.post<any>(`${environment.apiUrl}/sop/subtasks/${subtaskId}/upload-proof`, formData)
            .pipe(map(res => res.data));
    }

    raiseCompletionRequest(serviceId: number | string, note?: string): Observable<any> {
        return this.http.post<any>(`${environment.apiUrl}/sop/services/${serviceId}/raise-completion-request`, { note })
            .pipe(map(res => res.data));
    }

    reviewSubtask(subtaskId: number | string, action: 'approve' | 'request_changes', comment?: string): Observable<SOPSubtask> {
        return this.http.post<any>(`${environment.apiUrl}/sop/subtasks/${subtaskId}/review`, { action, comment })
            .pipe(map(res => res.data));
    }

    addSubtaskComment(subtaskId: number | string, comment: string): Observable<SOPComment> {
        return this.http.post<any>(`${environment.apiUrl}/sop/subtasks/${subtaskId}/comments`, { comment })
            .pipe(map(res => res.data));
    }

    respondCompletionRequest(requestId: number | string, action: 'approve' | 'reject', reason?: string): Observable<any> {
        return this.http.post<any>(`${environment.apiUrl}/sop/completion-requests/${requestId}/respond`, { action, reason })
            .pipe(map(res => res.data));
    }
}
