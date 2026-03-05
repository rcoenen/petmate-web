import React, { Component } from 'react'

interface MenuItem {
  label?: string;
  click?: () => void;
  enabled?: boolean;
  type?: 'separator' | 'normal';
}

interface ContextMenuAreaProps {
  menuItems: MenuItem[];
  style?: React.CSSProperties;
  children?: React.ReactNode;
};

interface ContextMenuAreaState {
  visible: boolean;
  x: number;
  y: number;
}

export default class ContextMenuArea extends Component<ContextMenuAreaProps, ContextMenuAreaState> {
  state: ContextMenuAreaState = { visible: false, x: 0, y: 0 };
  private rootElement = React.createRef<HTMLDivElement>();

  handleContextMenu = (e: MouseEvent) => {
    e.preventDefault();
    this.setState({ visible: true, x: e.clientX, y: e.clientY });
  }

  handleClose = () => this.setState({ visible: false });

  componentDidMount() {
    this.rootElement.current?.addEventListener('contextmenu', this.handleContextMenu);
    document.addEventListener('click', this.handleClose);
    document.addEventListener('contextmenu', this.handleDocContextMenu);
  }

  componentWillUnmount() {
    this.rootElement.current?.removeEventListener('contextmenu', this.handleContextMenu);
    document.removeEventListener('click', this.handleClose);
    document.removeEventListener('contextmenu', this.handleDocContextMenu);
  }

  // Close the menu if a context click lands outside our root element
  handleDocContextMenu = (e: MouseEvent) => {
    if (!this.rootElement.current?.contains(e.target as Node)) {
      this.setState({ visible: false });
    }
  }

  render() {
    const { visible, x, y } = this.state;
    return (
      <div style={{ ...this.props.style }} ref={this.rootElement}>
        {this.props.children}
        {visible && (
          <ul style={{
            position: 'fixed', left: x, top: y, zIndex: 1000,
            background: '#2a2a2a', border: '1px solid #555',
            padding: '4px 0', listStyle: 'none', margin: 0,
            minWidth: 160, boxShadow: '2px 2px 8px rgba(0,0,0,0.5)'
          }}>
            {this.props.menuItems.map((item, i) =>
              item.type === 'separator'
                ? <li key={i} style={{ borderTop: '1px solid #555', margin: '4px 0' }} />
                : <li
                    key={i}
                    onClick={() => {
                      if (item.enabled !== false && item.click) {
                        item.click();
                        this.handleClose();
                      }
                    }}
                    style={{
                      padding: '4px 16px',
                      cursor: item.enabled !== false ? 'pointer' : 'default',
                      opacity: item.enabled !== false ? 1 : 0.5,
                      color: '#eee', fontSize: 13
                    }}
                  >{item.label}</li>
            )}
          </ul>
        )}
      </div>
    );
  }
}
