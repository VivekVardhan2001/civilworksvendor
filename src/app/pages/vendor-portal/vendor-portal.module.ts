import { NgModule } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { IonicModule } from '@ionic/angular';
import { RouterModule, Routes } from '@angular/router';
import { VendorPortalPage } from './vendor-portal.page';
import { ChatPanelComponent } from '../../components/chat-panel/chat-panel.component';

const routes: Routes = [
    {
        path: '',
        component: VendorPortalPage
    }
];

@NgModule({
    imports: [
        CommonModule,
        FormsModule,
        IonicModule,
        RouterModule.forChild(routes),
        ChatPanelComponent
    ],
    declarations: [VendorPortalPage]
})
export class VendorPortalPageModule { }
