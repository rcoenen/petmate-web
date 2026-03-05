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
        <h2 className={styles.title}>PetMate Online</h2>
        <p className={styles.tagline}>A browser-based PETSCII editor</p>
        <p className={styles.body}>
          PetMate Online is a web port of{' '}
          <a href="https://github.com/nurpax/petmate" target="_blank" rel="noreferrer">
            Petmate
          </a>
          , the open-source PETSCII editor for Mac, Windows, and Linux by{' '}
          <a href="https://github.com/nurpax" target="_blank" rel="noreferrer">
            nurpax
          </a>
          .
        </p>
        <p className={styles.body}>
          All the same drawing tools, export formats, and multi-screen support —
          no install required.
        </p>
        <div className={styles.links}>
          <a href="https://github.com/nurpax/petmate" target="_blank" rel="noreferrer">
            Original Petmate on GitHub
          </a>
          <span className={styles.dot}>·</span>
          <a href="https://nurpax.github.io/petmate/" target="_blank" rel="noreferrer">
            Documentation
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
