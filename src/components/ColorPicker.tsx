// @flow
import React, { Component } from 'react';
import * as utils from '../utils'

import styles from './ColorPicker.module.css';
import { Rgb } from '../redux/types';

interface ColorPickerProps {
  scale: { scaleX: number, scaleY: number };
  colorPalette: Rgb[];
  selected: number;
  twoRows: boolean;
  /** Optional subset/reorder of color indices to display (e.g. for import bg picker). */
  colorIndices?: number[];
  /** Highlighted color index from Inspector tool (distinct from selected). */
  inspectedColorIndex?: number;

  onSelectColor: (idx: number) => void;
}

export default class ColorPicker extends Component<ColorPickerProps> {
  static defaultProps = {
    twoRows: false,
    scale: { scaleX:1, scaleY:1 }
  }
  render() {
    const { scaleX, scaleY } = this.props.scale
    const w = Math.floor(scaleX * 18 * 8)
    const h = Math.floor(scaleY * 4 * 8) + 2*2
    const blockWidth = (w / 8) - 4
    const blockHeight = blockWidth
    const indices = this.props.colorIndices ?? [0,1,2,3,4,5,6,7,8,9,10,11,12,13,14,15];
    const colors = indices.map((idx) => {
      const c = this.props.colorPalette[idx]
      const bg = utils.rgbToCssRgb(c)
      const style = {
        backgroundColor: bg,
        width: `${blockWidth}px`,
        height: `${blockHeight}px`
      }
      const isInspecting = this.props.inspectedColorIndex !== undefined;
      const isInspected = this.props.inspectedColorIndex === idx;
      const isSelected = !isInspecting && this.props.selected === idx;
      const cls = isSelected ? styles.boxSelected
        : isInspected ? styles.boxInspected
        : styles.box
      return (
        <div
          key={idx}
          onClick={() => this.props.onSelectColor(idx)}
          style={style}
          className={cls}/>
      )
    })
    let doubleRowsStyle = {}
    if (this.props.twoRows) {
      doubleRowsStyle = {
        width: `${w}px`,
        height: `${h}px`,
        flexWrap: 'wrap'
      }
    }
    return (
      <div
        className={styles.container}
        style={doubleRowsStyle}
      >
        {colors}
      </div>
    );
  }
}
