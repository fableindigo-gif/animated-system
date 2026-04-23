import {
  DynamicComponent,
  Renderer
} from "./chunk-LE62UOP7.js";
import "./chunk-KECT6LAV.js";
import "./chunk-5YSMMLC5.js";
import "./chunk-A7FRXOSW.js";
import "./chunk-PEEADQSW.js";
import "./chunk-Y6THCRK5.js";
import "./chunk-TREOF22W.js";
import {
  Component,
  ViewChild,
  setClassMetadata,
  viewChild,
  ɵɵInheritDefinitionFeature,
  ɵɵadvance,
  ɵɵclassMap,
  ɵɵconditional,
  ɵɵconditionalCreate,
  ɵɵdefineComponent,
  ɵɵelementContainer,
  ɵɵelementEnd,
  ɵɵelementStart,
  ɵɵgetCurrentView,
  ɵɵlistener,
  ɵɵnextContext,
  ɵɵproperty,
  ɵɵqueryAdvance,
  ɵɵstyleMap,
  ɵɵtext,
  ɵɵviewQuerySignal
} from "./chunk-A2DGQQFJ.js";
import {
  effect,
  signal,
  ɵɵresetView,
  ɵɵrestoreView
} from "./chunk-ZIK34A2Q.js";
import "./chunk-SN3C37HS.js";
import "./chunk-IYAMKWW5.js";
import "./chunk-QZRS5QDR.js";
import "./chunk-YSYTNXRR.js";
import "./chunk-IZIF4DQH.js";

// node_modules/@a2ui/angular/fesm2022/a2ui-angular-modal-mr9LmczA.mjs
var _c0 = ["dialog"];
function Modal_Conditional_0_Template(rf, ctx) {
  if (rf & 1) {
    const _r1 = ɵɵgetCurrentView();
    ɵɵelementStart(0, "dialog", 2, 0);
    ɵɵlistener("click", function Modal_Conditional_0_Template_dialog_click_0_listener($event) {
      ɵɵrestoreView(_r1);
      const ctx_r1 = ɵɵnextContext();
      return ɵɵresetView(ctx_r1.handleDialogClick($event));
    });
    ɵɵelementStart(2, "section")(3, "div", 3)(4, "button", 2);
    ɵɵlistener("click", function Modal_Conditional_0_Template_button_click_4_listener() {
      ɵɵrestoreView(_r1);
      const ctx_r1 = ɵɵnextContext();
      return ɵɵresetView(ctx_r1.closeDialog());
    });
    ɵɵelementStart(5, "span", 4);
    ɵɵtext(6, "close");
    ɵɵelementEnd()()();
    ɵɵelementContainer(7, 5);
    ɵɵelementEnd()();
  }
  if (rf & 2) {
    const ctx_r1 = ɵɵnextContext();
    ɵɵclassMap(ctx_r1.theme.components.Modal.backdrop);
    ɵɵadvance(2);
    ɵɵstyleMap(ctx_r1.theme.additionalStyles == null ? null : ctx_r1.theme.additionalStyles.Modal);
    ɵɵclassMap(ctx_r1.theme.components.Modal.element);
    ɵɵadvance(5);
    ɵɵproperty("surfaceId", ctx_r1.surfaceId())("component", ctx_r1.component().properties.contentChild);
  }
}
function Modal_Conditional_1_Template(rf, ctx) {
  if (rf & 1) {
    const _r3 = ɵɵgetCurrentView();
    ɵɵelementStart(0, "section", 2);
    ɵɵlistener("click", function Modal_Conditional_1_Template_section_click_0_listener() {
      ɵɵrestoreView(_r3);
      const ctx_r1 = ɵɵnextContext();
      return ɵɵresetView(ctx_r1.showDialog.set(true));
    });
    ɵɵelementContainer(1, 5);
    ɵɵelementEnd();
  }
  if (rf & 2) {
    const ctx_r1 = ɵɵnextContext();
    ɵɵadvance();
    ɵɵproperty("surfaceId", ctx_r1.surfaceId())("component", ctx_r1.component().properties.entryPointChild);
  }
}
var Modal = class _Modal extends DynamicComponent {
  showDialog = signal(false, ...ngDevMode ? [{
    debugName: "showDialog"
  }] : []);
  dialog = viewChild("dialog", ...ngDevMode ? [{
    debugName: "dialog"
  }] : []);
  constructor() {
    super();
    effect(() => {
      const dialog = this.dialog();
      if (dialog && !dialog.nativeElement.open) {
        dialog.nativeElement.showModal();
      }
    });
  }
  handleDialogClick(event) {
    if (event.target instanceof HTMLDialogElement) {
      this.closeDialog();
    }
  }
  closeDialog() {
    const dialog = this.dialog();
    if (!dialog) {
      return;
    }
    if (!dialog.nativeElement.open) {
      dialog.nativeElement.close();
    }
    this.showDialog.set(false);
  }
  static ɵfac = function Modal_Factory(__ngFactoryType__) {
    return new (__ngFactoryType__ || _Modal)();
  };
  static ɵcmp = ɵɵdefineComponent({
    type: _Modal,
    selectors: [["a2ui-modal"]],
    viewQuery: function Modal_Query(rf, ctx) {
      if (rf & 1) {
        ɵɵviewQuerySignal(ctx.dialog, _c0, 5);
      }
      if (rf & 2) {
        ɵɵqueryAdvance();
      }
    },
    features: [ɵɵInheritDefinitionFeature],
    decls: 2,
    vars: 1,
    consts: [["dialog", ""], [3, "class"], [3, "click"], [1, "controls"], [1, "g-icon"], ["a2ui-renderer", "", 3, "surfaceId", "component"]],
    template: function Modal_Template(rf, ctx) {
      if (rf & 1) {
        ɵɵconditionalCreate(0, Modal_Conditional_0_Template, 8, 8, "dialog", 1)(1, Modal_Conditional_1_Template, 2, 2, "section");
      }
      if (rf & 2) {
        ɵɵconditional(ctx.showDialog() ? 0 : 1);
      }
    },
    dependencies: [Renderer],
    styles: ["dialog[_ngcontent-%COMP%]{padding:0;border:none;background:none}dialog[_ngcontent-%COMP%]   section[_ngcontent-%COMP%]   .controls[_ngcontent-%COMP%]{display:flex;justify-content:end;margin-bottom:4px}dialog[_ngcontent-%COMP%]   section[_ngcontent-%COMP%]   .controls[_ngcontent-%COMP%]   button[_ngcontent-%COMP%]{padding:0;background:none;width:20px;height:20px;pointer:cursor;border:none;cursor:pointer}"]
  });
};
(() => {
  (typeof ngDevMode === "undefined" || ngDevMode) && setClassMetadata(Modal, [{
    type: Component,
    args: [{
      selector: "a2ui-modal",
      imports: [Renderer],
      template: `
    @if (showDialog()) {
      <dialog #dialog [class]="theme.components.Modal.backdrop" (click)="handleDialogClick($event)">
        <section [class]="theme.components.Modal.element" [style]="theme.additionalStyles?.Modal">
          <div class="controls">
            <button (click)="closeDialog()">
              <span class="g-icon">close</span>
            </button>
          </div>

          <ng-container
            a2ui-renderer
            [surfaceId]="surfaceId()!"
            [component]="component().properties.contentChild"
          />
        </section>
      </dialog>
    } @else {
      <section (click)="showDialog.set(true)">
        <ng-container
          a2ui-renderer
          [surfaceId]="surfaceId()!"
          [component]="component().properties.entryPointChild"
        />
      </section>
    }
  `,
      styles: ["dialog{padding:0;border:none;background:none}dialog section .controls{display:flex;justify-content:end;margin-bottom:4px}dialog section .controls button{padding:0;background:none;width:20px;height:20px;pointer:cursor;border:none;cursor:pointer}\n"]
    }]
  }], () => [], {
    dialog: [{
      type: ViewChild,
      args: ["dialog", {
        isSignal: true
      }]
    }]
  });
})();
export {
  Modal
};
//# sourceMappingURL=a2ui-angular-modal-mr9LmczA-XFJVLL4R.js.map
