import {
  JupyterFrontEnd,
  JupyterFrontEndPlugin
} from '@jupyterlab/application';

/**
 * Initialization data for the jupyterlab_cell_autorun_kernel_restart extension.
 */
const plugin: JupyterFrontEndPlugin<void> = {
  id: 'jupyterlab_cell_autorun_kernel_restart:plugin',
  autoStart: true,
  activate: (app: JupyterFrontEnd) => {
    console.log('JupyterLab extension jupyterlab_cell_autorun_kernel_restart is activated!');
  }
};

export default plugin;
