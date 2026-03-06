import React from 'react';
import { connect } from 'react-redux';
import { RootState, ColorMode, NewModeTarget } from '../redux/types';
import { Toolbar } from '../redux/toolbar';
import * as Root from '../redux/root';
import * as Screens from '../redux/screens';
import Modal from '../components/Modal';
import styles from './NewDocumentModeModal.module.css';

interface Props {
  show: boolean;
  target: NewModeTarget;
  onCancel: () => void;
  createNewWorkspace: (mode: ColorMode) => void;
  createNewScreen: (mode: ColorMode) => void;
}

function NewDocumentModeModal({ show, target, onCancel, createNewWorkspace, createNewScreen }: Props) {
  const handleSelect = (mode: ColorMode) => {
    if (target === 'screen') {
      createNewScreen(mode);
    } else {
      createNewWorkspace(mode);
    }
    onCancel();
  };

  const title = target === 'screen' ? 'New Screen Mode' : 'New Document Mode';
  const body = target === 'screen'
    ? 'Choose the screen format for the new screen.'
    : 'Choose the screen format for the new document.';

  return (
    <Modal showModal={show}>
      <div className={styles.container}>
        <h2 className={styles.title}>{title}</h2>
        <p className={styles.body}>
          {body}
        </p>
        <div className={styles.options}>
          <button className={styles.optionBtn} onClick={() => handleSelect('std')}>Standard</button>
          <button className={styles.optionBtn} onClick={() => handleSelect('ecm')}>Extended Color (ECM)</button>
          <button className={styles.optionBtn} onClick={() => handleSelect('mcm')}>Multi-color (MCM)</button>
        </div>
        <div className={styles.buttons}>
          <button className={styles.cancelBtn} onClick={onCancel}>Cancel</button>
        </div>
      </div>
    </Modal>
  );
}

export default connect(
  (state: RootState) => ({
    show: state.toolbar.showNewDocumentMode,
    target: state.toolbar.newModeTarget
  }),
  (dispatch) => ({
    onCancel: () => dispatch(Toolbar.actions.setShowNewDocumentMode(false)),
    createNewWorkspace: (mode: ColorMode) => dispatch(Root.actions.createNewWorkspace(mode)),
    createNewScreen: (mode: ColorMode) => dispatch(Screens.actions.newScreen(mode))
  })
)(NewDocumentModeModal);
