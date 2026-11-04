pub mod controller;

pub use controller::{
    get_available_monitors_list, get_cursor_pos, get_dock_position, get_expanded_dimensions,
    handle_fullscreen_visibility, is_cursor_near_dock, is_foreground_window_fullscreen,
    is_idle_hidden, is_show_over_fullscreen, set_active_monitor_by_index, set_dock_position,
    set_expanded_dimensions_internal, set_idle_hidden_state, set_show_over_fullscreen_state,
    snap_window_to_nearest_edge, switch_monitor, update_island_geometry,
    update_island_geometry_on_monitor, wake_up_from_idle, DockPosition, IslandState, MonitorInfo,
    SHOW_OVER_FULLSCREEN,
};
