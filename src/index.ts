import {
  JupyterFrontEnd,
  JupyterFrontEndPlugin
} from '@jupyterlab/application';

import {
  InputDialog,
  ToolbarButton
} from '@jupyterlab/apputils';

import {
  IMainMenu
} from '@jupyterlab/mainmenu';

import reinit from '../style/icons/reinit.svg';

import { Cell, CodeCell, CellModel } from '@jupyterlab/cells';

import {
  INotebookTracker, NotebookPanel
} from '@jupyterlab/notebook';
import { ConnectionStatus } from '@jupyterlab/services/lib/kernel/kernel';

import {LabIcon} from '@jupyterlab/ui-components'
import { Menu } from '@lumino/widgets';

const reinit_icon = new LabIcon({name: 'test', svgstr: reinit})

//import { find } from '@lumino/algorithm';

const EXT_NAME = 'cell_autorun_kernel_restart';
const INITCELL_ENABLED_CLASS = 'cell-autorun-kernel-restart-enabled';


class KernelReInitButton extends ToolbarButton {

  app: JupyterFrontEnd;
  nbtracker: INotebookTracker;
  mainmenu: IMainMenu;
  submenu: Menu | null;

  kernel_status_listener_connected: boolean;
  init_on_connect_stage: 'ignore reconnect' | 0 | 1;

  constructor(app: JupyterFrontEnd, nbtracker: INotebookTracker, mainmenu: IMainMenu) {
    super({onClick: () => { this.onReInitButtonClicked(); }, icon: reinit_icon, tooltip: 'Restart kernel and launch init cells'});

    this.app = app;
    this.nbtracker = nbtracker;
    this.mainmenu = mainmenu;
    this.submenu = null;

    this.kernel_status_listener_connected = false;

    this.init_on_connect_stage = 'ignore reconnect';
  }

  attach(nbpanel: NotebookPanel) {

    const toolbar = nbpanel.toolbar;
    let insertionPoint = 7;

    toolbar.insertItem(insertionPoint + 1, 'reinit_button', this);

    this.setupContextMenu();
    this.setupRestartCommand();
    this.setupMainMenu();

    nbpanel.context.sessionContext.ready.then(() => { this.onAllCellsInNotebookReady(nbpanel); });
  }


  /**
   * Privates
   */

  private addDefaultReinitDataCellIfNotPresent(nbpanel: NotebookPanel) {
    if(nbpanel.content.model) {

      let cell0 = nbpanel.content.widgets[0]
      console.log('aa', cell0.model.metadata.get('reinit_data'));

      if(!cell0.model.metadata.get('reinit_data')) {
        console.log('adding reinit datacell');

        let reinit_cell = new CellModel({
          cell: {cell_type: 'raw', source: ['ReInit Data Cell'], metadata: {reinit_data: true, scenes: ['default'], present_scene: 'default'}}
        });
        
        nbpanel.content.model.cells.insert(0, reinit_cell);
      }
    } else {
      console.error('could not add reinit cell');
    }
  }

  private getReinitDataCell(nbpanel: NotebookPanel) {
    let datacell = nbpanel.content.widgets[0];
    if(!datacell.model.metadata.get('reinit_data')) {
      console.error('inconsistent reinit data');
    }
    return datacell;
  }

  private setReinitDataCellStyle(nbpanel: NotebookPanel) {
      this.getReinitDataCell(nbpanel).hide();
  }

  private getPresentScene(nbpanel: NotebookPanel) {
    return this.getReinitDataCell(nbpanel).model.metadata.get('present_scene');
  }

  private setupMainMenu() {
    const reinit_menu = new Menu({commands: this.app.commands});
    reinit_menu.title.label = 'ReInit';

    reinit_menu.addItem({command: 'cell-autorun-kernel-restart:toggle-autorun'})
    reinit_menu.addItem({command: 'cell-autorun-kernel-restart:reinit'})

    reinit_menu.addItem({type: 'separator'})

    const command_id_dup = 'cell-autorun-kernel-restart:duplicate-scene';
    this.app.commands.addCommand(command_id_dup, {
      label: 'Duplicate Present Scene',
      execute: () => { this.duplicatePresentScene(); }
    });
    const command_id_rename = 'cell-autorun-kernel-restart:rename-scene';
    this.app.commands.addCommand(command_id_rename, {
      label: 'Rename Present Scene',
      execute: () => { this.renamePresentScene(); }
    });
    const command_id_del = 'cell-autorun-kernel-restart:delete-scene';
    this.app.commands.addCommand(command_id_del, {
      label: 'Delete Present Scene',
      execute: () => { this.deletePresentScene(); }
    });

    reinit_menu.addItem({command: command_id_dup})
    reinit_menu.addItem({command: command_id_rename})
    reinit_menu.addItem({command: command_id_del})

    reinit_menu.addItem({type: 'separator'})
    this.mainmenu.addMenu(reinit_menu);

    this.submenu = new Menu({commands: this.app.commands});
    this.submenu.title.label = 'Present Scene'
    reinit_menu.addItem({type: 'submenu', submenu: this.submenu});

  }

  private duplicatePresentScene() {
    const nbpanel = this.nbtracker.currentWidget;
    if(nbpanel) {

      const present_scene = this.getPresentScene(nbpanel);
      InputDialog.getText({title:'Name of the duplicated scene:'}).then(new_scene => {
        if(new_scene.value) {

          const old_scene_list = this.getReinitDataCell(nbpanel).model.metadata.get('scenes');
          const new_scene_list: string[] = [];
          for(let scene of old_scene_list as string[]) {
              new_scene_list.push(scene);
          }
          new_scene_list.push(new_scene.value);
          this.getReinitDataCell(nbpanel).model.metadata.set('scenes', new_scene_list);

          const md_tag_old = 'init_scene__' + present_scene;
          const md_tag_new = 'init_scene__' + new_scene.value;
          const notebook = nbpanel.content;
          notebook.widgets.map((cell: Cell) => {
            if(!!cell.model.metadata.get(md_tag_old)) {
              cell.model.metadata.set(md_tag_new, true);
            } else {
              cell.model.metadata.set(md_tag_new, false);
            }
          });

          this.updateScenesInMenu(nbpanel);
        }
      });
    }
  }

  private renamePresentScene() {
    const nbpanel = this.nbtracker.currentWidget;
    if(nbpanel) {

      const present_scene = this.getPresentScene(nbpanel);
      InputDialog.getText({title:'Name of the duplicated scene:'}).then(new_scene => {
        if(new_scene.value) {

          const old_scene_list = this.getReinitDataCell(nbpanel).model.metadata.get('scenes');
          const new_scene_list: string[] = [];
          for(let scene of old_scene_list as string[]) {
            if(scene != present_scene) {
              new_scene_list.push(scene);
            }
          }
          new_scene_list.push(new_scene.value);
          this.getReinitDataCell(nbpanel).model.metadata.set('scenes', new_scene_list);

          const md_tag_old = 'init_scene__' + present_scene;
          const md_tag_new = 'init_scene__' + new_scene.value;
          const notebook = nbpanel.content;
          notebook.widgets.map((cell: Cell) => {
            if(!!cell.model.metadata.get(md_tag_old)) {
              cell.model.metadata.set(md_tag_new, true);
              cell.model.metadata.delete(md_tag_old);
            } else {
              cell.model.metadata.set(md_tag_new, false);
              cell.model.metadata.delete(md_tag_old);
            }
          });

          this.updateScenesInMenu(nbpanel);

        }
      });
    }
  }

  private deletePresentScene() {
    const nbpanel = this.nbtracker.currentWidget;
    if(nbpanel) {

      const present_scene = this.getPresentScene(nbpanel);

      const old_scene_list = this.getReinitDataCell(nbpanel).model.metadata.get('scenes');
      const new_scene_list: string[] = [];
      for(let scene of old_scene_list as string[]) {
        if(scene != present_scene) {
          new_scene_list.push(scene);
        }
      }
      this.getReinitDataCell(nbpanel).model.metadata.set('scenes', new_scene_list);

      const md_tag_old = 'init_scene__' + present_scene;
      const notebook = nbpanel.content;
      notebook.widgets.map((cell: Cell) => {
        if(!!cell.model.metadata.get(md_tag_old)) {
          cell.model.metadata.delete(md_tag_old);
        } else {
          cell.model.metadata.delete(md_tag_old);
        }
      });

      this.updateScenesInMenu(nbpanel); 
    }
  }

  private updateScenesInMenu(nbpanel: NotebookPanel) {
    const scene_list = this.getReinitDataCell(nbpanel).model.metadata.get('scenes');
    if(scene_list && this.submenu) {
      this.submenu.clearItems();
      for(let scene of scene_list as string[]) {
        const command_id = this.ensureSceneActivationCommandExistsAndReturnCommandId(scene);
        this.submenu.addItem({command: command_id});
      }
    }
  }

  private ensureSceneActivationCommandExistsAndReturnCommandId(scene: string) {
    const command_id = 'init_scene_activate__' + scene;
    if(!this.app.commands.hasCommand(command_id)) {
      this.app.commands.addCommand(command_id, {
        label: scene,
        isToggled: () => { 
          if(this.nbtracker.currentWidget) {
            return scene == this.getPresentScene(this.nbtracker.currentWidget); 
          } else {
            return false;
          }
        },
        execute: () => { 
          if(this.nbtracker.currentWidget) {
            this.getReinitDataCell(this.nbtracker.currentWidget).model.metadata.set('present_scene', scene); 
            this.setCellStyles(this.nbtracker.currentWidget);
          } 
        }
      });
    }
    return command_id;
  }

  private setCellStyles(nbpanel: NotebookPanel) {

    if(this.nbtracker.currentWidget) {
      const md_tag = 'init_scene__';
      const present_scene = this.getPresentScene(this.nbtracker.currentWidget);      
      const md_tag_ext = md_tag + present_scene;

      const notebook = nbpanel.content;
      notebook.widgets.map((cell: Cell) => {
        if(!!cell.model.metadata.get(md_tag_ext)) {
          cell.addClass(INITCELL_ENABLED_CLASS);
        } else {
          cell.removeClass(INITCELL_ENABLED_CLASS);
        }
      });
    }  
  }

  private setupContextMenu() {

    const command_id = 'cell-autorun-kernel-restart:toggle-autorun';

    this.app.commands.addCommand(command_id, {
      label: 'Toggle Init Cell',
      execute: () => { this.toggleInitCell(); }
    });

    this.app.commands.addKeyBinding({
      command: command_id,
      args: {},
      keys: ['Accel I'],
      selector: '.jp-Notebook'
    })

    this.app.contextMenu.addItem({
      command: command_id,
      selector: '.jp-Cell',
      rank: 501
    });
  }

  private setupRestartCommand() {
    const command_id = 'cell-autorun-kernel-restart:reinit';

    this.app.commands.addCommand(command_id, {
      label: 'Restart kernel and launch init cells',
      execute: () => { this.onReInitButtonClicked(); }
    })

    this.app.commands.addKeyBinding({
      command: command_id,
      args: {},
      keys: ['Accel 0', 'Accel 0'],
      selector: '.jp-Notebook'
    })
  }

  private async doKernelInitialization() {

    const md_tag = 'init_scene__';
    
    if(this.nbtracker.currentWidget) {
      const present_scene = this.getPresentScene(this.nbtracker.currentWidget);
      const md_tag_ext = md_tag + present_scene;
      console.log('executing all cell with tag', md_tag_ext)

      const notebook = this.nbtracker.currentWidget.content;
      const notebookPanel = this.nbtracker.currentWidget;

      notebook.widgets.map((cell: Cell) => {

        if(!!cell.model.metadata.get(md_tag_ext)) {
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
    const md_tag = 'init_scene__';

    if(this.nbtracker.currentWidget && cell) {
      const present_scene = this.getPresentScene(this.nbtracker.currentWidget);      
      const md_tag_ext = md_tag + present_scene;

      if(!cell.model.metadata.get(md_tag_ext)) {
        cell.model.metadata.set(md_tag_ext, true)
        cell.addClass(INITCELL_ENABLED_CLASS);
      } else {
        cell.model.metadata.set(md_tag_ext, false)
        cell.removeClass(INITCELL_ENABLED_CLASS);
      }

    }
  }

  onAllCellsInNotebookReady(nbpanel: NotebookPanel) {
    this.addDefaultReinitDataCellIfNotPresent(nbpanel);
    this.setReinitDataCellStyle(nbpanel);
    this.updateScenesInMenu(nbpanel);

    this.setCellStyles(nbpanel);
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
  requires: [INotebookTracker, IMainMenu],
  activate: (app: JupyterFrontEnd, nbtracker_: INotebookTracker, mainmenu: IMainMenu) => {

    nbtracker_.widgetAdded.connect((nbtracker: INotebookTracker, nbpanel: NotebookPanel | null) => {
      if(nbpanel) {
        let but = new KernelReInitButton(app, nbtracker, mainmenu);
        but.attach(nbpanel);
      }
    });
    
  }
};

export default plugin;
