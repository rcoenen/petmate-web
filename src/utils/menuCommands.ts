import { formats, promptProceedWithUnsavedChanges } from './index';
import { loadSDD } from './importers';
import * as ReduxRoot from '../redux/root';
import { Toolbar } from '../redux/toolbar';
import { actions as settingsActions } from '../redux/settings';
import { FileFormat, CrtFilter, RootState } from '../redux/types';

type StoreDispatch = any;
type GetState = () => RootState;

function dispatchExport(dispatch: StoreDispatch, fmt: FileFormat) {
  if (formats[fmt.ext].exportOptions) {
    dispatch(Toolbar.actions.setShowExport({ show: true, fmt }));
  } else {
    dispatch(ReduxRoot.actions.fileExportAs(fmt));
  }
}

const demo2025SddPaths = [
  'petscii-compo-25/01_The_Three_Graces.sdd',
  'petscii-compo-25/02_FutureProof.sdd',
  'petscii-compo-25/03_ATROTOS.sdd',
  'petscii-compo-25/04_TheMilkshakeManPet-msm.sdd',
  'petscii-compo-25/05_ShadyChars.sdd',
  'petscii-compo-25/06_plain.sdd',
  'petscii-compo-25/07_theracemyd.sdd',
  'petscii-compo-25/08_CPUend.sdd',
  'petscii-compo-25/09_Technomancy_Skleptoid.sdd',
  'petscii-compo-25/10_hohenzollern.sdd',
  'petscii-compo-25/11_TRIAD-ICU.sdd',
  'petscii-compo-25/12_I_yam_what_I_yam.sdd',
  'petscii-compo-25/13_TRIAD-Sloot.sdd',
  'petscii-compo-25/14_cathode_ray_mission_ldx40.sdd',
  'petscii-compo-25/15_whohoo_myd.sdd',
  'petscii-compo-25/16_otl_aicher.sdd',
  'petscii-compo-25/17_rain.sdd',
  'petscii-compo-25/18_who_ya_gonna_call.sdd',
  'petscii-compo-25/19_plain2.sdd',
  'petscii-compo-25/20_Mallorca.sdd',
];

export function dispatchMenuCommand(
  command: string,
  dispatch: StoreDispatch,
  getState: GetState
) {
  if (command.startsWith('load-demo-sdd:')) {
    const relativePath = command.slice('load-demo-sdd:'.length);
    fetch(import.meta.env.BASE_URL + `demo/${relativePath}`)
      .then(r => r.text())
      .then(text => {
        const framebufs = loadSDD(text);
        dispatch(ReduxRoot.actions.importFramebufsAppend(framebufs));
      });
    return;
  }

  switch (command) {
    case 'about':
      dispatch(Toolbar.actions.setShowAbout(true));
      return;
    case 'undo':
      dispatch(ReduxRoot.actions.undo());
      return;
    case 'redo':
      dispatch(ReduxRoot.actions.redo());
      return;
    case 'new':
      promptProceedWithUnsavedChanges(getState(), {
        title: 'Reset',
        detail: 'This will empty your workspace.  This cannot be undone.'
      }).then(ok => {
        if (ok) {
          dispatch(Toolbar.actions.setNewModeTarget('workspace'));
          dispatch(Toolbar.actions.setShowNewDocumentMode(true));
        }
      });
      return;
    case 'open':
      dispatch(ReduxRoot.actions.fileOpenWorkspace());
      return;
    case 'save-as':
      dispatch(ReduxRoot.actions.fileSaveAsWorkspace());
      return;
    case 'save':
      dispatch(ReduxRoot.actions.fileSaveWorkspace());
      return;
    case 'share-url':
      dispatch(ReduxRoot.actions.shareURL());
      return;
    case 'export-png':
      dispatchExport(dispatch, formats.png);
      return;
    case 'export-seq':
      dispatchExport(dispatch, formats.seq);
      return;
    case 'export-marq-c':
      dispatchExport(dispatch, formats.c);
      return;
    case 'export-asm':
      dispatchExport(dispatch, formats.asm);
      return;
    case 'export-basic':
      dispatchExport(dispatch, formats.bas);
      return;
    case 'export-prg':
      dispatchExport(dispatch, formats.prg);
      return;
    case 'export-gif':
      dispatchExport(dispatch, formats.gif);
      return;
    case 'export-json':
      dispatchExport(dispatch, formats.json);
      return;
    case 'export-pet':
      dispatchExport(dispatch, formats.pet);
      return;
    case 'export-sdd':
      dispatchExport(dispatch, formats.sdd);
      return;
    case 'import-d64':
      dispatch(ReduxRoot.actions.fileImportAppend(formats.d64));
      return;
    case 'import-marq-c':
      dispatch(ReduxRoot.actions.fileImportAppend(formats.c));
      return;
    case 'convert-image':
      dispatch(Toolbar.actions.setShowImageConverter(true));
      return;
    case 'import-seq':
      dispatch(ReduxRoot.actions.fileImportAppend(formats.seq));
      return;
    case 'import-sdd':
      dispatch(ReduxRoot.actions.fileImportAppend(formats.sdd));
      return;
    case 'import-vce':
      dispatch(ReduxRoot.actions.fileImportAppend(formats.vce));
      return;
    case 'load-demo-logo':
      fetch(import.meta.env.BASE_URL + 'demo/Petscii_logo_std.sdd')
        .then(r => r.text())
        .then(text => {
          const framebufs = loadSDD(text);
          dispatch(ReduxRoot.actions.importFramebufsAppend(framebufs));
        });
      return;
    case 'load-demo-all-2025':
      Promise.all(
        demo2025SddPaths.map(path =>
          fetch(import.meta.env.BASE_URL + `demo/${path}`)
            .then(r => r.text())
            .then(loadSDD)
        )
      ).then((allFramebufs) => {
        const merged = allFramebufs.flat();
        dispatch(ReduxRoot.actions.importFramebufsAppend(merged));
      });
      return;
    case 'preferences':
      dispatch(Toolbar.actions.setShowSettings(true));
      return;
    case 'new-screen':
      dispatch(Toolbar.actions.setNewModeTarget('screen'));
      dispatch(Toolbar.actions.setShowNewDocumentMode(true));
      return;
    case 'shift-screen-left':
      dispatch(Toolbar.actions.shiftHorizontal(-1));
      return;
    case 'shift-screen-right':
      dispatch(Toolbar.actions.shiftHorizontal(+1));
      return;
    case 'shift-screen-up':
      dispatch(Toolbar.actions.shiftVertical(-1));
      return;
    case 'shift-screen-down':
      dispatch(Toolbar.actions.shiftVertical(+1));
      return;
    case 'custom-fonts':
      dispatch(Toolbar.actions.setShowCustomFonts(true));
      return;
    case 'crt-none':
    case 'crt-scanlines':
    case 'crt-colorTv':
    case 'crt-bwTv': {
      const crtFilter = command.replace('crt-', '') as CrtFilter;
      dispatch(settingsActions.setCrtFilter({ branch: 'saved', crtFilter }));
      dispatch(settingsActions.setCrtFilter({ branch: 'editing', crtFilter }));
      dispatch(settingsActions.saveEdits());
      return;
    }
    case 'toggle-file-info-panel': {
      const current = getState().toolbar.showFileInfoPanel;
      dispatch(Toolbar.actions.setShowFileInfoPanel(!current));
      return;
    }
    case 'toggle-preview-grid': {
      const current = getState().toolbar.canvasGrid;
      dispatch(Toolbar.actions.setCanvasGrid(!current));
      return;
    }
    case 'toggle-color-mode-labels': {
      const current = getState().toolbar.showColorModeLabels;
      dispatch(Toolbar.actions.setShowColorModeLabels(!current));
      return;
    }
    case 'reset-workspace':
      dispatch(Toolbar.actions.setShowResetConfirm(true));
      return;
    default:
      console.warn('unknown menu command:', command);
  }
}
