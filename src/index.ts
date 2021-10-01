import {
  JupyterFrontEnd,
  JupyterFrontEndPlugin
} from '@jupyterlab/application';

import {
  ToolbarButton
} from '@jupyterlab/apputils';


import reinit from '../style/icons/reinit.svg';

import { Cell, CodeCell } from '@jupyterlab/cells';

import {
  INotebookTracker, NotebookPanel
} from '@jupyterlab/notebook';
import { ConnectionStatus } from '@jupyterlab/services/lib/kernel/kernel';

import {LabIcon} from '@jupyterlab/ui-components'

const reinit_icon = new LabIcon({name: 'test', svgstr: reinit})

//import { find } from '@lumino/algorithm';

const EXT_NAME = 'cell_autorun_kernel_restart';
const INITCELL = '${EXT_NAME}:initcell'
const INITCELL_ENABLED_CLASS = 'cell-autorun-kernel-restart-enabled'


class KernelReInitButton extends ToolbarButton {

  app: JupyterFrontEnd;
  nbtracker: INotebookTracker;

  kernel_status_listener_connected: boolean;
  init_on_connect_stage: 'ignore reconnect' | 0 | 1;


  constructor(app: JupyterFrontEnd, nbtracker: INotebookTracker) {
    super({onClick: () => { this.onReInitButtonClicked(); }, icon: reinit_icon, tooltip: 'Restart kernel and launch init cells'});

    this.app = app;
    this.nbtracker = nbtracker;
    this.kernel_status_listener_connected = false;

    this.init_on_connect_stage = 'ignore reconnect';

  }

  attach(nbpanel: NotebookPanel) {

    const toolbar = nbpanel.toolbar;
    let insertionPoint = 7;

    toolbar.insertItem(insertionPoint + 1, 'reinit_button', this);

    this.setupContextMenu();
    this.setCellStyles(nbpanel);

    nbpanel.context.sessionContext.ready.then(() => { this.setCellStyles(nbpanel); });

  }

  /**
   * Privates
   */

  private setCellStyles(nbpanel: NotebookPanel) {

    const notebook = nbpanel.content;
    notebook.widgets.map((cell: Cell) => {
      if(!!cell.model.metadata.get(INITCELL)) {
        cell.addClass(INITCELL_ENABLED_CLASS);
      }
    });
    
  }

  private setupContextMenu() {

    const command_id = '${EXT_NAME}:toggle_autorun';

    this.app.commands.addCommand(command_id, {
      label: 'Toggle Init Cell',
      execute: () => { this.toggleInitCell(); }
    });

    this.app.contextMenu.addItem({
      command: command_id,
      selector: '.jp-Cell',
      rank: 0
    });
  }

  private async doKernelInitialization() {

    if(this.nbtracker.currentWidget) {
      const notebook = this.nbtracker.currentWidget.content;
      const notebookPanel = this.nbtracker.currentWidget;

      notebook.widgets.map((cell: Cell) => {

        if(!!cell.model.metadata.get(INITCELL)) {
          if(cell.model.type == 'code') {
            CodeCell.execute(cell as CodeCell, notebookPanel.sessionContext);
          }
        }

      });
    }
  }

  /**
   * Callbacks
   */

  toggleInitCell() {

    const cell = this.nbtracker.activeCell;

    if(cell) {

      if(!!cell.model.metadata.get(INITCELL)) {
        cell.model.metadata.set(INITCELL, false);
        cell.removeClass(INITCELL_ENABLED_CLASS);
      } else {
        cell.model.metadata.set(INITCELL, true);
        cell.addClass(INITCELL_ENABLED_CLASS);
      }
    }
  }

  onReInitButtonClicked() {

    if(!this.kernel_status_listener_connected) {
      this.nbtracker.currentWidget?.context.sessionContext.session?.kernel?.connectionStatusChanged.connect((_unused, conn_stat) => { 
        this.kernelConnectionStatusListener(conn_stat); 
      });
      this.kernel_status_listener_connected = true;
    }
    this.init_on_connect_stage = 0;
    this.nbtracker.currentWidget?.context.sessionContext.session?.kernel?.restart();
  }

  kernelConnectionStatusListener(conn_stat: ConnectionStatus) {
    
    if(this.init_on_connect_stage == 'ignore reconnect') {
      return;
    }

    if(this.init_on_connect_stage == 0 && conn_stat == 'connecting') {
      this.init_on_connect_stage = 1;
      return;
    } 

    if(this.init_on_connect_stage == 1 && conn_stat == 'connected') {
      this.doKernelInitialization();
      this.init_on_connect_stage = 'ignore reconnect';
      return;
    } 
  }
}



/**
 * Initialization data for the jupyterlab_cell_autorun_kernel_restart extension.
 */
const plugin: JupyterFrontEndPlugin<void> = {
  id: EXT_NAME,
  autoStart: true,
  requires: [INotebookTracker],
  activate: (app: JupyterFrontEnd, nbtracker: INotebookTracker) => {

    nbtracker.widgetAdded.connect((nbtracker_: INotebookTracker, nbpanel: NotebookPanel | null) => {
      if(nbpanel) {
        let but = new KernelReInitButton(app, nbtracker_);
        but.attach(nbpanel);
      }
    });
    
  }
};

export default plugin;
