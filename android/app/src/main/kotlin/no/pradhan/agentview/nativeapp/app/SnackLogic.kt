package no.pradhan.agentview.nativeapp.app

const val SNACK_MS = 5000L

// How long a snack stays: the requested time, longer when the platform recommends it for accessibility.
fun snackMillis(requested: Long, recommended: Long) = maxOf(requested, recommended, SNACK_MS)
