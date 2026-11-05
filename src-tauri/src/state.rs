use std::sync::Arc;
use parking_lot::Mutex;
use sysinfo::System;
use crate::window::IslandState;

#[derive(Clone, Default)]
pub struct IslandStateHolder(pub Arc<Mutex<IslandState>>);

pub struct SystemMetricsHolder(pub Arc<Mutex<System>>);
