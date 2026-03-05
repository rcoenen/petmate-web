import React from 'react';
import { connect } from 'react-redux';
import { Toolbar } from '../redux/toolbar';
import { RootState } from '../redux/types';
import Modal from '../components/Modal';
import styles from './AboutModal.module.css';
import buildInfo from '../../build.json';

interface Props {
  show: boolean;
  onClose: () => void;
}

function AboutModal({ show, onClose }: Props) {
  return (
    <Modal showModal={show}>
      <div className={styles.container}>
        <h2 className={styles.title}>Petsciishop</h2>
        <p className={styles.tagline}>A web-based C64 PETSCII graphics editor</p>
        <p className={styles.body}>
          Drawing tools, export formats, image conversion, multi-screen
          support — all in your browser, no install required.
        </p>
        <p className={styles.body}>
          Originally inspired by{' '}
          <a href="https://github.com/nurpax/petmate" target="_blank" rel="noreferrer">
            Petmate
          </a>
          {' '}by nurpax.
        </p>
        <div className={styles.links}>
          <a href="https://github.com/rcoenen/Petscii-shop" target="_blank" rel="noreferrer">
            Petsciishop on GitHub
          </a>
        </div>
        <p className={styles.buildNum}>Build {buildInfo.build}</p>
        <button className={styles.closeBtn} onClick={onClose}>Close</button>
      </div>
    </Modal>
  );
}

export default connect(
  (state: RootState) => ({ show: state.toolbar.showAbout }),
  (dispatch) => ({ onClose: () => dispatch(Toolbar.actions.setShowAbout(false)) })
)(AboutModal);
