import React from 'react';
import { connect } from 'react-redux';
import { Toolbar } from '../redux/toolbar';
import { RootState } from '../redux/types';
import Modal from '../components/Modal';
import styles from './AboutModal.module.css';
import buildInfo from '../../build.json';
import pkg from '../../package.json';

interface Props {
  show: boolean;
  onClose: () => void;
}

function AboutModal({ show, onClose }: Props) {
  return (
    <Modal showModal={show}>
      <div className={styles.container}>
        <img src={import.meta.env.BASE_URL + 'assets/petsciishop_logo.png'} alt='Petsciishop' className={styles.logo} />
        <div className={styles.versionBlock}>
          <h2 className={styles.version}>v{pkg.version}</h2>
          <p className={styles.buildNum}>Build {buildInfo.build}</p>
        </div>
        <p className={styles.tagline}>An 🔓 open source, web-based 🕹️ C64 PETSCII graphics editor on steroids. 💪</p>
        <p className={styles.body}>
          Drawing tools, export formats, state-of-the-art best-in-class image
          conversion, multi-screen support — all in your browser, no install required.
        </p>
        <p className={styles.body}>
          <span className={styles.engineBadge}>TruSkii3000™</span> image-to-PETSCII converter included.
        </p>
        <p className={styles.body}>
          Originally inspired by{' '}
          <a href="https://github.com/nurpax/petmate" target="_blank" rel="noreferrer">
            Petmate
          </a>
          {' '}by nurpax.
        </p>
        <div className={styles.links}>
          <a href="https://github.com/rcoenen/Petsciishop" target="_blank" rel="noreferrer">
            Petsciishop on GitHub
          </a>
        </div>
        <button className={styles.closeBtn} onClick={onClose}>Close</button>
      </div>
    </Modal>
  );
}

export default connect(
  (state: RootState) => ({ show: state.toolbar.showAbout }),
  (dispatch) => ({ onClose: () => dispatch(Toolbar.actions.setShowAbout(false)) })
)(AboutModal);
