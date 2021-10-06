import { JupyterFrontEnd, JupyterFrontEndPlugin } from '@jupyterlab/application';
import { Dialog, InputDialog, ToolbarButton } from '@jupyterlab/apputils';
import { IMainMenu } from '@jupyterlab/mainmenu';
import { Cell, CodeCell, CellModel } from '@jupyterlab/cells';
import { INotebookTracker, NotebookPanel } from '@jupyterlab/notebook';
import { ConnectionStatus, IKernelConnection } from '@jupyterlab/services/lib/kernel/kernel';
import { LabIcon } from '@jupyterlab/ui-components'
import { Menu } from '@lumino/widgets';

import reinit from '../style/icons/reinit.svg';
const reinit_icon = new LabIcon({name: 'test', svgstr: reinit})

const verbose = false;

class ReInit {
  app: JupyterFrontEnd;
  nbtracker: INotebookTracker;
  mainmenu: IMainMenu;
  submenu: Menu | null;
  reinit_menu: Menu | null;

  kernel_status_listener_connected: boolean;
  init_on_connect_stage: 'ignore reconnect' | 0 | 1;

  command_id_new_empty_scene  = 'cell-autorun-kernel-restart:new-scene';
  command_id_duplicate_scene =  'cell-autorun-kernel-restart:duplicate-scene';
  command_id_rename_scene =     'cell-autorun-kernel-restart:rename-scene';
  command_id_delete_scene =     'cell-autorun-kernel-restart:delete-scene';
  command_id_toggle_init_cell = 'cell-autorun-kernel-restart:toggle-initcell';
  command_id_do_reinit =        'cell-autorun-kernel-restart:do-reinit';

  constructor(app: JupyterFrontEnd, nbtracker: INotebookTracker, mainmenu: IMainMenu) {
    if(verbose) console.log('Called constructor of ReInit');

    this.app = app;
    this.nbtracker = nbtracker;
    this.mainmenu = mainmenu;
    this.submenu = null;
    this.reinit_menu = null;

    this.kernel_status_listener_connected = false;
    this.init_on_connect_stage = 'ignore reconnect';
  }

  initialize() {
    this.setupGlobalCommands()
    this.setupReinitMenu() 

    // connect some callbacks
    this.nbtracker.widgetAdded.connect((sender, nbpanel) => { this.onNotebookTabAdded(nbpanel); });
    this.nbtracker.currentChanged.connect((sender, nbpanel) => { this.onActiveNotebookChanged(nbpanel); });
  }

  /** ****************************************************************************************************************************************
   * Internal Helper Methods
   */

  // **** setup helpers **********************************************************************************************************************
  
  private setupReinitMenu() {
    this.reinit_menu = new Menu({commands: this.app.commands});
    this.reinit_menu.title.label = 'ReInit';

    this.reinit_menu.addItem({command: this.command_id_do_reinit});
    this.reinit_menu.addItem({command: this.command_id_toggle_init_cell});
    this.reinit_menu.addItem({type: 'separator'});
    this.reinit_menu.addItem({command: this.command_id_new_empty_scene});
    this.reinit_menu.addItem({command: this.command_id_duplicate_scene});
    this.reinit_menu.addItem({command: this.command_id_rename_scene});
    this.reinit_menu.addItem({command: this.command_id_delete_scene});
    this.reinit_menu.addItem({type: 'separator'});

    this.submenu = new Menu({commands: this.app.commands});
    this.reinit_menu.addItem({type: 'submenu', submenu: this.submenu});

    this.mainmenu.addMenu(this.reinit_menu);

    this.updateSceneMenu();
  }

  private setupGlobalCommands() {
    // setup all commands this.command_id_* including key bindings

    this.app.commands.addCommand(this.command_id_do_reinit, {
      label: 'Restart kernel and launch init cells',
      execute: () => { this.doReInit(); }
    })

    this.app.commands.addKeyBinding({
      command: this.command_id_do_reinit,
      args: {},
      keys: ['Accel 0', 'Accel 0'],
      selector: '.jp-Notebook'
    })
  
    this.app.commands.addCommand(this.command_id_toggle_init_cell, {
      label: 'Toggle Init Cell',
      execute: () => { this.toggleInitCell(); }
    });

    this.app.commands.addKeyBinding({
      command: this.command_id_toggle_init_cell,
      args: {},
      keys: ['Accel I'],
      selector: '.jp-Notebook'
    })

    this.app.commands.addCommand(this.command_id_new_empty_scene, {
      label: 'New empty Scene',
      execute: () => { this.newEmptyScene(); }
    });

    this.app.commands.addCommand(this.command_id_duplicate_scene, {
      label: 'Duplicate Present Scene',
      execute: () => { this.duplicatePresentScene(); }
    });

    this.app.commands.addCommand(this.command_id_rename_scene, {
      label: 'Rename Present Scene',
      execute: () => { this.renamePresentScene(); }
    });

    this.app.commands.addCommand(this.command_id_delete_scene, {
      label: 'Delete Present Scene',
      execute: () => { this.deletePresentScene(); }
    });

  }

  private setupToolbarButton(nbpanel: NotebookPanel) {
    let button = new ToolbarButton({
      icon: reinit_icon,
      onClick: () => {this.doReInit(); },
      tooltip: 'Restart kernel and launch init cells'
    })

    nbpanel.toolbar.insertItem(8, 'reinit_button', button);
  }

  // **** access to ReInit metadata **********************************************************************************************************

  private addDefaultReinitDataCellIfNotPresent(nbpanel: NotebookPanel) {
     
    if(nbpanel.content.model) {

      const cell0 = nbpanel.content.widgets[0];
      
      if(!cell0 || !cell0.model.metadata.get('reinit_data')) {
        if(verbose) console.log('Adding default ReInit Data Cell');

        var reinit_cell = new CellModel({
          cell: {cell_type: 'raw', source: ['ReInit Data Cell'], metadata: {reinit_data: true, scenes: ['Default Scene'], present_scene: 'Default Scene'}}
        });
        
        nbpanel.content.model.cells.insert(0, reinit_cell);
        nbpanel.content.update(); // doesn't seem to help
      }
    } else {
      console.error('Could not add default ReInit Data Cell');
    }
  }

  private getCurrentNotebookReinitDataCell() {

    if(verbose) console.log('getCurrentNotebookReinitDataCell', this.nbtracker.currentWidget?.context.path);

    const nbpanel = this.nbtracker.currentWidget;
    if(!nbpanel) return null;

    let datacell = nbpanel.content.widgets[0];
    if(!datacell.model.metadata.get('reinit_data')) {
      console.error('inconsistent reinit data');
      return null;
    }

    return datacell;
  }

  private getCurrentNotebookSceneList() {
    const datacell = this.getCurrentNotebookReinitDataCell();
    if(!datacell) return null;

    return datacell.model.metadata.get('scenes') as string[];
  }

  private getCurrentNotebookPresentScene() {
    const datacell = this.getCurrentNotebookReinitDataCell();
    if(!datacell) return null;

    const scene_list = this.getCurrentNotebookSceneList()
    if(scene_list == null || scene_list.length == 0) {
      console.error('scene_list is empty');
      return null;
    }
    const present_scene = datacell.model.metadata.get('present_scene')?.toString();
    
    if(!present_scene) {
      return scene_list[0];
    } else {
      return present_scene;
    }
  }

  private setCurrentNotebookPresentScene(scene_name: string) {
    const datacell = this.getCurrentNotebookReinitDataCell();
    if(!datacell) return;

    const scene_list = this.getCurrentNotebookSceneList()
    if(scene_list == null || scene_list.length == 0) {
      console.error('scene_list is empty');
      return;
    }

    if(!scene_list.includes(scene_name)) {
      console.error('scene not in scene_list')
    }

    datacell.model.metadata.set('present_scene', scene_name);
  }

  private setCurrentNotebookSceneList(scene_list: string[]) {
    const datacell = this.getCurrentNotebookReinitDataCell();
    if(!datacell) return;

    datacell.model.metadata.set('scenes', scene_list);
  }

  private setReinitDataCellStyle() {
    this.getCurrentNotebookReinitDataCell()?.hide();
  }

  private async doKernelInitialization() {
    if(!this.nbtracker.currentWidget) return;

    const present_scene = this.getCurrentNotebookPresentScene();
    if(!present_scene) return;

    const md_tag_ext = 'init_scene__' + present_scene;

    if(verbose) console.log('executing all cell with tag', md_tag_ext)

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

  // **** various ****************************************************************************************************************************

  private updateSceneMenu() {

    if(!this.submenu || !this.reinit_menu) return;

    this.submenu.title.label = 'Present Scene: <none>';
    this.reinit_menu.title.label = 'ReInit';
    this.submenu.clearItems();

    const scene_list = this.getCurrentNotebookSceneList();
    const present_scene = this.getCurrentNotebookPresentScene();
    if(scene_list == null) return;

    this.submenu.title.label = 'Present Scene: ' + present_scene;
    this.reinit_menu.title.label = 'ReInit: (' + present_scene + ')';

    for(const scene_name of scene_list) {
      const command_id = this.ensureSceneActivationCommandExistsAndReturnCommandId(scene_name);
      this.submenu.addItem({command: command_id})
    }
  }

  private ensureSceneActivationCommandExistsAndReturnCommandId(scene: string) {
    const command_id = 'init_scene_activate__' + scene;
    if(!this.app.commands.hasCommand(command_id)) {
      this.app.commands.addCommand(command_id, {
        label: scene,
        isToggled: () => { return scene == this.getCurrentNotebookPresentScene(); },
        execute: () => { 
          this.setCurrentNotebookPresentScene(scene);
          this.updateInitCellDots();
          this.updateSceneMenu();  
        }
      });
    }
    return command_id;
  }

  private updateInitCellDots() {
    const nbpanel = this.nbtracker.currentWidget;
    if(!nbpanel) return;

    const present_scene = this.getCurrentNotebookPresentScene();
    const md_tag_ext = 'init_scene__' + present_scene;

    const notebook = nbpanel.content;
    notebook.widgets.map((cell: Cell) => {
      if(!!cell.model.metadata.get(md_tag_ext)) {
        cell.addClass('cell-autorun-kernel-restart-enabled');
      } else {
        cell.removeClass('cell-autorun-kernel-restart-enabled');
      }
    });
  }  

  /** ****************************************************************************************************************************************
   * Callbacks
   */

  // **** handle own commands ****************************************************************************************************************

  async doReInit() {

    const result = await (new Dialog({
      title: 'Do you really want to re-initialize the kernel with scene "' + this.getCurrentNotebookPresentScene() + '"?',
      buttons: [Dialog.cancelButton(), Dialog.okButton({label: 'Restart'})]
    }).launch());

    if(result.button.label == 'Restart') {  
      this.init_on_connect_stage = 0;
      this.nbtracker.currentWidget?.context.sessionContext.session?.kernel?.restart();
    }
  }

  toggleInitCell() {
    if(verbose) console.log('Toggle Init Cell');

    const cell = this.nbtracker.activeCell;
    if(!cell) return;
    
    const present_scene = this.getCurrentNotebookPresentScene();
    const md_tag_ext = 'init_scene__' + present_scene;

    if(!cell.model.metadata.get(md_tag_ext)) {
      cell.model.metadata.set(md_tag_ext, true)
      cell.addClass('cell-autorun-kernel-restart-enabled');
    } else {
      cell.model.metadata.delete(md_tag_ext)
      cell.removeClass('cell-autorun-kernel-restart-enabled');
    }
  }

  newEmptyScene() {
    if(verbose) console.log('Generating new empty scene');

    const old_scene_list = this.getCurrentNotebookSceneList();
    if(!old_scene_list) return;

    InputDialog.getText({title:'Name of the new scene:'}).then(new_scene => {

      if(!new_scene.value) return;

      const new_scene_list: string[] = Object.assign([], old_scene_list);  // copy old_scene_list over
      new_scene_list.push(new_scene.value);
      this.setCurrentNotebookSceneList(new_scene_list);

      this.setCurrentNotebookPresentScene(new_scene.value);
      this.updateSceneMenu();  
      this.updateInitCellDots();
    });

  }

  duplicatePresentScene() {
    if(verbose) console.log('Duplicating present scene');

    const present_scene = this.getCurrentNotebookPresentScene();
    if(!present_scene) return;

    const old_scene_list = this.getCurrentNotebookSceneList();
    if(!old_scene_list) return;

    const nbpanel = this.nbtracker.currentWidget;
    if(!nbpanel) return;

    InputDialog.getText({title:'Name of the new scene:'}).then(new_scene => {

      if(!new_scene.value) return;

      // TODO: make sure new scene is not in old scene list

      const new_scene_list: string[] = Object.assign([], old_scene_list);  // copy old_scene_list over
      new_scene_list.push(new_scene.value);
      this.setCurrentNotebookSceneList(new_scene_list);

      // set the init_scene__* tags for the new scene
      const md_tag_old = 'init_scene__' + present_scene;
      const md_tag_new = 'init_scene__' + new_scene.value;
      const notebook = nbpanel.content;
      notebook.widgets.map((cell: Cell) => {
        if(!!cell.model.metadata.get(md_tag_old)) {
          cell.model.metadata.set(md_tag_new, true);
        }
      });
      this.setCurrentNotebookPresentScene(new_scene.value);
      this.updateSceneMenu();  
      this.updateInitCellDots();
    });
  }

  renamePresentScene() {
    if(verbose) console.log('Renaming present scene');

    const present_scene = this.getCurrentNotebookPresentScene();
    if(!present_scene) return;

    const old_scene_list = this.getCurrentNotebookSceneList();
    if(!old_scene_list) return;

    const nbpanel = this.nbtracker.currentWidget;
    if(!nbpanel) return;

    InputDialog.getText({title:'New name of the scene:'}).then(new_scene_name => {
      if(!new_scene_name.value) return;

      const new_scene_list: string[] = [];
      for(let scene of old_scene_list) {
        if(scene != present_scene) {
          new_scene_list.push(scene);
        } else {
          new_scene_list.push(new_scene_name.value);
        }
      }
      this.setCurrentNotebookSceneList(new_scene_list);

      const md_tag_old = 'init_scene__' + present_scene;
      const md_tag_new = 'init_scene__' + new_scene_name.value;
      const notebook = nbpanel.content;
      notebook.widgets.map((cell: Cell) => {
        if(!!cell.model.metadata.get(md_tag_old)) {
          cell.model.metadata.set(md_tag_new, true);
        } 
        cell.model.metadata.delete(md_tag_old);

      });
      this.setCurrentNotebookPresentScene(new_scene_name.value);
      this.updateSceneMenu();  
      this.updateInitCellDots();
    });

  }

  async deletePresentScene() {
    if(verbose) console.log('Deleting present scene');

    const present_scene = this.getCurrentNotebookPresentScene();
    if(!present_scene) return;

    const old_scene_list = this.getCurrentNotebookSceneList();
    if(!old_scene_list) return;

    if(old_scene_list.length == 1) {
      console.log('cannot delete the last scene')
      return
    }

    const nbpanel = this.nbtracker.currentWidget;
    if(!nbpanel) return;

    const dialog = new Dialog({
      title: 'Do you really want to delete scene "' + present_scene + '"?',
      buttons: [Dialog.okButton({label: 'Delete'}), Dialog.cancelButton()]
    });

    const result = await dialog.launch();

    if(result.button.label == 'Delete') {

      const new_scene_list: string[] = [];
      for(let scene of old_scene_list) {
        if(scene != present_scene) {
          new_scene_list.push(scene);
        }
      }
      this.setCurrentNotebookSceneList(new_scene_list);

      const md_tag_old = 'init_scene__' + present_scene;
      const notebook = nbpanel.content;
      notebook.widgets.map((cell: Cell) => {
        cell.model.metadata.delete(md_tag_old); 
      });

      this.setCurrentNotebookPresentScene(new_scene_list[0]);
      this.updateSceneMenu();  
      this.updateInitCellDots();
    }
  }

  // **** react to jupyterlab UI events ******************************************************************************************************

  onNotebookTabAdded(nbpanel: NotebookPanel) {
    // this is called whenever a new tab for a notebook is opened (includes a new view)
    if(verbose) console.log('Got new notebook tab for path:', nbpanel.context.path);

    nbpanel.context.sessionContext.ready.then(() => { this.onAllCellsInNotebookReady(nbpanel); });
    this.setupToolbarButton(nbpanel);
  }

  onActiveNotebookChanged(nbpanel: NotebookPanel|null) {
    
    if(!nbpanel) return;
    if(verbose) console.log('Changed active notebook tab:', nbpanel.context.path);

    if(!nbpanel.context.sessionContext.isReady) {
      if(verbose) console.log('Notebook not ready yet:', nbpanel.context.path);
      return;
    }

    this.updateSceneMenu();
    this.updateInitCellDots();
    this.setReinitDataCellStyle();
  }

  onAllCellsInNotebookReady(nbpanel: NotebookPanel) {
    if(verbose) console.log('All cells ready:', nbpanel.context.path);

    this.addDefaultReinitDataCellIfNotPresent(nbpanel);
    if(!nbpanel.context.sessionContext.session) {
      console.error('ERROR 01');
      return;
    }
    if(!nbpanel.context.sessionContext.session.kernel) {
      console.error('ERROR 02');
      return;
    }
    nbpanel.context.sessionContext.session.kernel.connectionStatusChanged.connect((kernel, conn_stat) => {
      this.kernelConnectionStatusListener(kernel, conn_stat);
    });

    if(nbpanel != this.nbtracker.currentWidget) {
      return;
    }

    this.updateSceneMenu();
    this.updateInitCellDots();
    this.setReinitDataCellStyle();
  }

  kernelConnectionStatusListener(kernel: IKernelConnection, conn_stat: ConnectionStatus) {
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
  id: 'cell-autorun-kernel-restart',
  autoStart: true,
  requires: [INotebookTracker, IMainMenu],
  activate: (app: JupyterFrontEnd, nbtracker_: INotebookTracker, mainmenu: IMainMenu) => {

    const reinit_obj = new ReInit(app, nbtracker_, mainmenu);
    reinit_obj.initialize();

  }
};

export default plugin;
